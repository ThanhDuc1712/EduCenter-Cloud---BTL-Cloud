import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logging/app-logger';
import { OpsLogService } from '../../common/observability/ops-log.service';
import { TelemetryService } from '../../common/observability/telemetry.service';
import { STORAGE_PROVIDER, storageKeys, type StorageProvider } from '../storage/storage.types';
import { parseHmacKeys, signCallback } from './hmac';
import { retriggerFromLatest } from './retrigger';
import type { DispatchJob, ProcessingDispatcher } from './materials.service';
import { inspectPdf } from './pdf-inspect';
import { RESULT_SCHEMA, type ProcessingResult } from './processing-result';

export type CallbackSender = (rawBody: Buffer, headers: Record<string, string>) => Promise<{ status: number }>;

/**
 * LOCAL MODE processor — a MOCK of Alibaba Function Compute running inside the API process.
 * It is labelled LOCAL_MOCK everywhere (jobs, UI, logs) and is never reported as cloud.
 * It nevertheless follows the real contract: read quarantine → validate PDF → write document,
 * preview and result JSON to the published area → HMAC-signed HTTP callback to the API.
 */
@Injectable()
export class LocalProcessingDispatcher implements ProcessingDispatcher {
  readonly kind = 'LOCAL_MOCK' as const;
  private readonly inFlight = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  /** Overridable in tests. */
  sender: CallbackSender;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: AppConfigService,
    private readonly ops: OpsLogService,
    private readonly telemetry: TelemetryService,
    private readonly logger: AppLogger,
  ) {
    this.sender = async (rawBody, headers) => {
      const res = await fetch(new URL('/api/v1/internal/material-callback', this.config.get('INTERNAL_BASE_URL')), { method: 'POST', body: new Uint8Array(rawBody), headers: { ...headers, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000) });
      return { status: res.status };
    };
  }

  async dispatch(job: DispatchJob): Promise<{ sourceVersionId?: string | null }> {
    // A retry has a new key: the object must exist there before anything can process it.
    const copied = job.isRetry ? await retriggerFromLatest(this.storage, job) : null;
    const response = copied ? { sourceVersionId: copied.versionId } : {};
    if (this.inFlight.has(job.materialId)) return response; // duplicate dispatch protection
    this.inFlight.add(job.materialId);
    // Serial queue: one document at a time, like a single FC instance.
    this.queue = this.queue
      .then(() => this.run(job))
      .catch((err) => this.logger.event('error', 'local.processor.crashed', { errorName: (err as Error)?.name, materialId: job.materialId }, 'LocalProcessor'))
      .finally(() => this.inFlight.delete(job.materialId));
    return response;
  }

  /** Waits for queued work (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async run(job: DispatchJob): Promise<void> {
    const startedAt = new Date();
    const started = performance.now();
    await this.ops.write({ provider: 'LOCAL', service: 'LOCAL_PROCESSOR', level: 'INFO', event: 'processor.started', message: `[MOCK FC] Bắt đầu xử lý lần ${job.attempt}`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
    const head = await this.storage.head('quarantine', job.sourceKey);
    const bytes = head ? await this.storage.get('quarantine', job.sourceKey) : null;
    const base = { schema: RESULT_SCHEMA, eventId: `local:${job.jobId}:${randomUUID().slice(0, 8)}`, tenantId: job.tenantId, materialId: job.materialId, sourceKey: job.sourceKey, sourceVersionId: head?.versionId ?? null, correlationId: job.correlationId, processor: 'LOCAL_MOCK' as const, attempt: job.attempt, startedAt: startedAt.toISOString() };

    let result: ProcessingResult;
    if (!bytes) {
      result = { ...base, status: 'FAILED', finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), result: null, error: { code: 'SOURCE_MISSING', message: 'Không tìm thấy tệp nguồn trong quarantine' } };
    } else {
      const inspected = await inspectPdf(bytes, this.config.get('UPLOAD_MAX_BYTES'));
      if (!inspected.ok) {
        result = { ...base, status: 'REJECTED', finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), result: null, error: { code: inspected.code, message: inspected.message } };
      } else {
        const documentKey = storageKeys.document(job.tenantId, job.materialId, job.attempt, base.sourceVersionId);
        const previewKey = storageKeys.preview(job.tenantId, job.materialId, job.attempt, base.sourceVersionId, 'pdf');
        await this.storage.put('published', documentKey, bytes, 'application/pdf', { 'material-id': job.materialId, sha256: inspected.sha256 });
        await this.storage.put('published', previewKey, inspected.preview, 'application/pdf', { 'material-id': job.materialId });
        result = {
          ...base,
          status: 'READY',
          finishedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - started),
          result: { sizeBytes: inspected.sizeBytes, sha256: inspected.sha256, pageCount: inspected.pageCount, title: inspected.title, author: inspected.author, documentKey, previewKey, previewContentType: 'application/pdf' },
          error: null,
        };
      }
    }

    const raw = Buffer.from(JSON.stringify(result));
    // Result JSON first: if the callback is lost the reconciler can still apply it.
    await this.storage.put('published', storageKeys.result(job.tenantId, job.materialId, job.attempt, base.sourceVersionId), raw, 'application/json');
    this.telemetry.dependency({ name: 'local.processor', type: 'LocalProcessor', target: 'in-process', durationMs: result.durationMs, success: result.status !== 'FAILED' });
    await this.ops.write({ provider: 'LOCAL', service: 'LOCAL_PROCESSOR', level: result.status === 'READY' ? 'INFO' : 'WARN', event: `processor.${result.status.toLowerCase()}`, message: `[MOCK FC] ${result.status}${result.error ? ` – ${result.error.code}` : ` – ${result.result?.pageCount} trang`}`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId, durationMs: result.durationMs });
    await this.sendCallback(raw, job);
  }

  private async sendCallback(raw: Buffer, job: DispatchJob): Promise<void> {
    const keys = parseHmacKeys(this.config.get('CALLBACK_HMAC_KEYS'));
    const keyId = this.config.get('CALLBACK_HMAC_ACTIVE_KEY_ID');
    const secret = keys.get(keyId);
    if (!secret) {
      await this.ops.write({ provider: 'LOCAL', service: 'CALLBACK', level: 'ERROR', event: 'callback.no_key', message: `CALLBACK_HMAC_ACTIVE_KEY_ID=${keyId} không có trong CALLBACK_HMAC_KEYS`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
      return;
    }
    const delays = [0, 500, 2000, 5000];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      const started = performance.now();
      try {
        const { status } = await this.sender(raw, signCallback(keyId, secret, raw));
        this.telemetry.dependency({ name: 'callback.http', type: 'Callback', target: '/internal/material-callback', durationMs: performance.now() - started, success: status < 300, resultCode: status });
        if (status < 300) return;
        if (status < 500) break; // 4xx will not succeed on retry
      } catch {
        this.telemetry.dependency({ name: 'callback.http', type: 'Callback', target: '/internal/material-callback', durationMs: performance.now() - started, success: false });
      }
      await this.ops.write({ provider: 'LOCAL', service: 'CALLBACK', level: 'WARN', event: 'callback.retry', message: `Callback thất bại, thử lại (${i + 1}/${delays.length})`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
    }
    await this.ops.write({ provider: 'LOCAL', service: 'CALLBACK', level: 'ERROR', event: 'callback.gave_up', message: 'Callback không thành công — reconciler sẽ đọc result JSON', tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
  }
}

/**
 * CLOUD MODE: Function Compute is triggered by the OSS ObjectCreated event of the upload itself, so
 * the first attempt needs no action. A retry copies the quarantine object to the new attempt's key,
 * which raises ObjectCreated:CopyObject and triggers the function again.
 */
@Injectable()
export class AliyunFcDispatcher implements ProcessingDispatcher {
  readonly kind = 'ALIYUN_FC' as const;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly ops: OpsLogService,
  ) {}

  async dispatch(job: DispatchJob): Promise<{ sourceVersionId?: string | null }> {
    if (!job.isRetry) {
      await this.ops.write({ provider: 'ALIYUN', service: 'FUNCTION_COMPUTE', level: 'INFO', event: 'fc.awaiting_trigger', message: 'Chờ OSS trigger kích hoạt Function Compute', tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
      return {};
    }
    const { versionId } = await retriggerFromLatest(this.storage, job);
    await this.ops.write({ provider: 'ALIYUN', service: 'OSS', level: 'INFO', event: 'fc.retriggered', message: `Sao chép object sang key của lần ${job.attempt} để kích hoạt lại FC (version ${versionId ?? '-'})`, tenantId: job.tenantId, materialId: job.materialId, correlationId: job.correlationId });
    return { sourceVersionId: versionId };
  }
}
