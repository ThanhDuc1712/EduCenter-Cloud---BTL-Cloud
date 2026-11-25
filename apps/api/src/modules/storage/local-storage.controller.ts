import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';
import type { Request, Response } from 'express';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { PublicPolicy } from '../../common/authz/policy.decorator';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppException } from '../../common/errors/app-exception';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { OpsLogService } from '../../common/observability/ops-log.service';
import type { LocalDownloadClaims, LocalStorageProvider, LocalUploadClaims } from './local-storage.provider';
import { verifyToken } from './signed-token';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';

/**
 * LOCAL MODE only: emulates the two OSS operations the browser performs directly —
 * PostObject upload (with a signed, expiring policy) and signed GET. Authorization is the HMAC token
 * itself, exactly like OSS, hence the public policy. Returns 404 when OSS is configured.
 */
@Controller('storage/local')
@PublicPolicy()
export class LocalStorageController {
  private readonly upload: ReturnType<typeof multer>;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    config: AppConfigService,
    private readonly telemetry: TelemetryService,
    private readonly ops: OpsLogService,
  ) {
    this.upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.get('UPLOAD_MAX_BYTES'), files: 1, fields: 10, fieldSize: 8 * 1024 } });
  }

  private local(): LocalStorageProvider {
    if (this.storage.kind !== 'LOCAL') throw new AppException(ErrorCode.NOT_FOUND, 404, 'Resource not found');
    return this.storage as LocalStorageProvider;
  }

  @Post('upload')
  @HttpCode(204)
  async uploadObject(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const local = this.local();
    const started = performance.now();
    await new Promise<void>((resolve, reject) =>
      this.upload.single('file')(req, res, (err?: unknown) => {
        if (!err) return resolve();
        const code = (err as { code?: string }).code;
        reject(code === 'LIMIT_FILE_SIZE' ? new AppException(ErrorCode.PAYLOAD_TOO_LARGE, 413, 'Tệp vượt quá dung lượng cho phép') : new AppException(ErrorCode.VALIDATION_FAILED, 400, 'Yêu cầu upload không hợp lệ'));
      }),
    );
    const body = req.body as Record<string, string>;
    const claims = verifyToken<LocalUploadClaims>(local.tokenSecret, body.token ?? '');
    if (!claims || claims.bucket !== 'quarantine') throw new AppException(ErrorCode.FORBIDDEN, 403, 'Upload policy không hợp lệ hoặc đã hết hạn');
    const file = req.file;
    if (!file || file.size === 0) throw new AppException(ErrorCode.VALIDATION_FAILED, 400, 'Thiếu tệp tải lên');
    if (file.size > claims.maxBytes) throw new AppException(ErrorCode.PAYLOAD_TOO_LARGE, 413, 'Tệp vượt quá dung lượng cho phép');
    await local.put('quarantine', claims.key, file.buffer, claims.contentType, claims.metadata);
    const durationMs = performance.now() - started;
    this.telemetry.dependency({ name: 'storage.local.upload', type: 'LocalStorage', target: local.bucketName('quarantine'), durationMs, success: true });
    await this.ops.write({ provider: 'LOCAL', service: 'LOCAL_STORAGE', level: 'INFO', event: 'storage.upload.received', message: `Nhận tệp ${file.size} bytes vào quarantine (local)`, materialId: claims.metadata['material-id'], tenantId: claims.metadata['tenant-id'], durationMs: Math.round(durationMs), detail: { key: claims.key, size: file.size } });
  }

  @Get('object')
  async getObject(@Query('token') token: string | undefined, @Res() res: Response): Promise<void> {
    const local = this.local();
    const claims = verifyToken<LocalDownloadClaims>(local.tokenSecret, token ?? '');
    if (!claims) throw new AppException(ErrorCode.FORBIDDEN, 403, 'Liên kết đã hết hạn hoặc không hợp lệ');
    const info = await local.head(claims.bucket, claims.key);
    if (!info) throw new AppException(ErrorCode.NOT_FOUND, 404, 'Resource not found');
    const filename = claims.filename ?? claims.key.split('/').pop() ?? 'file';
    res.setHeader('Content-Type', claims.contentType ?? info.contentType ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Content-Disposition', `${claims.disposition}; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Same-origin preview inside the SPA (iframe) is allowed; nothing else.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    createReadStream(local.pathFor(claims.bucket, claims.key)).pipe(res);
  }
}
