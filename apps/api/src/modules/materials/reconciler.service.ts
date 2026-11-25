import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import type { Prisma } from '../../generated/prisma/client';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logging/app-logger';
import { OpsLogService } from '../../common/observability/ops-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { STORAGE_PROVIDER, storageKeys, type StorageProvider } from '../storage/storage.types';
import { MaterialsService } from './materials.service';
import { parseProcessingResult } from './processing-result';

/** Constant advisory-lock key for the material reconciler (any 64-bit integer, fixed). */
const LOCK_KEY = 74_201_101n;
const BATCH = 50;

export interface ReconcileSummary {
  skipped?: 'LOCKED';
  uploadsCompleted: number;
  uploadsExpired: number;
  resultsApplied: number;
  retried: number;
  failed: number;
  opsLogsPurged: number;
  durationMs: number;
}

/**
 * Reconciliation job (D-32): finds materials stuck in UPLOADING / PROCESSING, reads the stored
 * result JSON, syncs the DB, retries a bounded number of times, then fails them. Only one instance
 * runs at a time — `pg_try_advisory_lock` on a dedicated connection (session lock needs one
 * connection for lock + unlock). Runs are recorded in `background_job_runs`.
 */
@Injectable()
export class MaterialReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly materials: MaterialsService,
    private readonly config: AppConfigService,
    private readonly ops: OpsLogService,
    private readonly logger: AppLogger,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onApplicationBootstrap(): void {
    const every = this.config.get('RECONCILE_INTERVAL_SECONDS');
    if (every > 0 && this.config.get('NODE_ENV') !== 'test') {
      this.timer = setInterval(() => void this.runOnce().catch(() => undefined), every * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(trigger: 'SCHEDULE' | 'MANUAL' = 'SCHEDULE'): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { uploadsCompleted: 0, uploadsExpired: 0, resultsApplied: 0, retried: 0, failed: 0, opsLogsPurged: 0, durationMs: 0 };
    if (this.running) return { ...summary, skipped: 'LOCKED' };
    this.running = true;
    const started = Date.now();
    const lock = new Client({ connectionString: this.config.get('DATABASE_URL'), connectionTimeoutMillis: 5000 });
    let locked = false;
    let runId: string | undefined;
    try {
      await lock.connect();
      const r = await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS ok', [LOCK_KEY.toString()]);
      locked = r.rows[0]?.ok === true;
      if (!locked) return { ...summary, skipped: 'LOCKED' };
      runId = (await this.prisma.backgroundJobRun.create({ data: { name: 'material-reconciler', status: 'RUNNING', summary: { trigger } } })).id;
      await this.reconcileUploads(summary);
      await this.reconcileProcessing(summary);
      summary.opsLogsPurged = (await this.prisma.opsLogEntry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } })).count;
      summary.durationMs = Date.now() - started;
      await this.prisma.backgroundJobRun.update({ where: { id: runId }, data: { status: 'SUCCEEDED', finishedAt: new Date(), summary: { trigger, ...summary } as unknown as Prisma.InputJsonValue } });
      const changed = summary.uploadsCompleted + summary.uploadsExpired + summary.resultsApplied + summary.retried + summary.failed;
      if (changed > 0 || trigger === 'MANUAL') {
        await this.ops.write({ provider: 'AZURE', service: 'RECONCILER', level: summary.failed ? 'WARN' : 'INFO', event: 'reconcile.completed', message: `Đối soát: ${summary.resultsApplied} áp dụng kết quả, ${summary.retried} thử lại, ${summary.failed} lỗi, ${summary.uploadsCompleted}/${summary.uploadsExpired} upload hoàn tất/hết hạn`, durationMs: summary.durationMs, detail: { ...summary } });
      }
      return summary;
    } catch (err) {
      this.logger.event('error', 'reconcile.failed', { errorName: (err as Error)?.name }, 'Reconciler');
      if (runId) await this.prisma.backgroundJobRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), summary: { trigger, error: (err as Error)?.name ?? 'unknown' } } }).catch(() => undefined);
      throw err;
    } finally {
      if (locked) await lock.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY.toString()]).catch(() => undefined);
      await lock.end().catch(() => undefined);
      this.running = false;
    }
  }

  /** UPLOADING: object present → continue the pipeline; past expiry and absent → FAILED. */
  private async reconcileUploads(s: ReconcileSummary): Promise<void> {
    const graceMs = 60_000;
    const rows = await this.prisma.material.findMany({ where: { status: 'UPLOADING', createdAt: { lt: new Date(Date.now() - graceMs) } }, orderBy: { createdAt: 'asc' }, take: BATCH });
    const expiry = this.config.get('UPLOAD_EXPIRY_SECONDS') * 1000;
    for (const m of rows) {
      const head = await this.storage.head('quarantine', m.quarantineKey);
      if (head) {
        await this.materials.markUploaded(m.tenantId, m.id, head.size, head.versionId, 'RECONCILER');
        s.uploadsCompleted += 1;
      } else if (Date.now() - m.createdAt.getTime() > expiry) {
        await this.prisma.$transaction((db) => this.materials.transition(db, m, 'FAILED', { rejectReason: 'Hết hạn tải lên — chưa nhận được tệp' }, { type: 'upload.expired', source: 'RECONCILER' }));
        await this.prisma.materialProcessingJob.updateMany({ where: { materialId: m.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'UPLOAD_EXPIRED', errorMessage: 'Không nhận được tệp trong thời hạn' } });
        s.uploadsExpired += 1;
      }
    }
  }

  /** PROCESSING past the timeout: apply stored result JSON, else retry (bounded), else FAILED. */
  private async reconcileProcessing(s: ReconcileSummary): Promise<void> {
    const timeoutMs = this.config.get('PROCESSING_TIMEOUT_SECONDS') * 1000;
    const rows = await this.prisma.material.findMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - timeoutMs) } }, include: { jobs: { orderBy: { attempt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'asc' }, take: BATCH });
    const maxAttempts = this.config.get('PROCESSING_MAX_ATTEMPTS');
    for (const m of rows) {
      const raw = await this.storage.get('published', storageKeys.result(m.tenantId, m.id));
      if (raw) {
        try {
          const parsed = parseProcessingResult(JSON.parse(raw.toString('utf8')));
          if (parsed.ok && parsed.value.materialId === m.id && parsed.value.tenantId === m.tenantId) {
            const sameVersion = !m.sourceVersionId || !parsed.value.sourceVersionId || m.sourceVersionId === parsed.value.sourceVersionId;
            const fresh = new Date(parsed.value.finishedAt).getTime() >= (m.processingAt?.getTime() ?? 0) - 1000;
            if (sameVersion && fresh) {
              const res = await this.materials.applyResult({ ...parsed.value, eventId: `reconcile:${parsed.value.eventId}`.slice(0, 100) }, 'RECONCILER');
              if (res.applied) {
                s.resultsApplied += 1;
                continue;
              }
            }
          }
        } catch {
          // Corrupt result JSON: fall through to retry.
        }
      }
      const job = m.jobs[0];
      if ((job?.attempt ?? 0) < maxAttempts) {
        const principal = { tenantId: m.tenantId, tenantSlug: '', tenantName: '', role: 'ADMIN' as const, personaKey: 'system:reconciler', displayName: 'Reconciler' };
        const retried = await this.materials.retry(principal, m.id, 'RECONCILER');
        if (retried) {
          s.retried += 1;
          continue;
        }
      }
      await this.prisma.$transaction(async (db) => {
        const fresh = await db.material.findFirstOrThrow({ where: { id: m.id } });
        if (fresh.status !== 'PROCESSING') return;
        await this.materials.transition(db, fresh, 'FAILED', { rejectReason: `Quá thời gian xử lý sau ${job?.attempt ?? 0} lần thử` }, { type: 'processing.timeout', source: 'RECONCILER', jobId: job?.id });
        if (job) await db.materialProcessingJob.update({ where: { id: job.id }, data: { status: 'TIMED_OUT', finishedAt: new Date(), errorCode: 'PROCESSING_TIMEOUT', errorMessage: 'Không nhận được kết quả trong thời hạn' } });
      });
      s.failed += 1;
    }
  }
}
