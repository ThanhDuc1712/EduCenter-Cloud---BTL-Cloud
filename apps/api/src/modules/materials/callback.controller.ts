import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';
import type { Request } from 'express';
import { InternalHmacPolicy } from '../../common/authz/policy.decorator';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppException } from '../../common/errors/app-exception';
import { OpsLogService } from '../../common/observability/ops-log.service';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { parseHmacKeys, verifyCallback } from './hmac';
import { MaterialsService } from './materials.service';
import { parseProcessingResult } from './processing-result';

/**
 * POST /api/v1/internal/material-callback — Function Compute (or the LOCAL worker) → API.
 * Body is the raw Buffer (BodyParserMiddleware) so the HMAC covers the exact bytes. Every failure
 * returns the same 401 without saying which check failed; details go to the ops log only.
 */
@Controller('internal')
export class MaterialCallbackController {
  private readonly keys: Map<string, string>;

  constructor(
    private readonly materials: MaterialsService,
    private readonly config: AppConfigService,
    private readonly ops: OpsLogService,
    private readonly telemetry: TelemetryService,
  ) {
    this.keys = parseHmacKeys(config.get('CALLBACK_HMAC_KEYS'));
  }

  @Post('material-callback')
  @InternalHmacPolicy()
  @HttpCode(HttpStatus.OK)
  async callback(@Req() req: Request) {
    const started = performance.now();
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    const verdict = verifyCallback(this.keys, req.headers, raw, this.config.get('CALLBACK_MAX_SKEW_SECONDS'));
    if (!verdict.ok) {
      this.telemetry.metric('callback.rejected', 1, false);
      await this.ops.write({ provider: 'AZURE', service: 'CALLBACK', level: 'WARN', event: 'callback.auth_failed', message: `Callback bị từ chối: ${verdict.reason}`, detail: { reason: verdict.reason, ip: req.ip } });
      throw new AppException(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'Invalid callback signature');
    }
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new AppException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, 'Malformed JSON body');
    }
    const parsed = parseProcessingResult(json);
    if (!parsed.ok) {
      await this.ops.write({ provider: 'AZURE', service: 'CALLBACK', level: 'WARN', event: 'callback.invalid_body', message: `Callback sai cấu trúc: ${parsed.problems.join(', ')}` });
      throw new AppException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, 'Invalid callback payload');
    }
    const outcome = await this.materials.applyResult(parsed.value, 'CALLBACK');
    this.telemetry.dependency({ name: 'callback.handle', type: 'Callback', target: 'material-callback', durationMs: performance.now() - started, success: true });
    // BUG-02: a log row that names a material must carry its tenant (from the DB); without one, omit the ids.
    const scope = outcome.tenantId
      ? { tenantId: outcome.tenantId, materialId: parsed.value.materialId, correlationId: parsed.value.correlationId ?? null }
      : { tenantId: null, materialId: null, correlationId: null };
    if (outcome.duplicate) {
      await this.ops.write({ provider: parsed.value.processor === 'ALIYUN_FC' ? 'ALIYUN' : 'LOCAL', service: 'CALLBACK', level: 'INFO', event: 'callback.duplicate', message: 'Callback lặp lại (eventId đã xử lý) — bỏ qua', ...scope });
    } else if (!outcome.applied) {
      await this.ops.write({ provider: parsed.value.processor === 'ALIYUN_FC' ? 'ALIYUN' : 'LOCAL', service: 'CALLBACK', level: 'WARN', event: 'callback.ignored', message: `Callback không được áp dụng: ${outcome.reason}`, ...scope });
    }
    return { received: true, applied: outcome.applied, duplicate: outcome.duplicate ?? false, keyId: verdict.keyId };
  }
}
