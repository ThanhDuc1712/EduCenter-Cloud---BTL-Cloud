import { Inject, Injectable } from '@nestjs/common';
import type { CloudProvider, LogLevel, Prisma, ProcessingJobStatus } from '../../generated/prisma/client';
import { badRequest } from '../../common/authz/scope';
import { AppConfigService } from '../../common/config/app-config.service';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { appInsightsClient } from '../../common/observability/appinsights-bootstrap';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { materialIdFromKey, STORAGE_PROVIDER, type BucketRole, type StorageProvider } from '../storage/storage.types';
import { MaterialReconciler } from '../materials/reconciler.service';
import { PROCESSING_DISPATCHER, type ProcessingDispatcher } from '../materials/materials.service';
import { AliyunApiError, AliyunClient } from './aliyun.client';
import { AzureApiError, AzureClient } from './azure.client';

export type ServiceStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED' | 'MOCK' | 'LOCAL';

export interface ServiceCheck {
  id: string;
  provider: 'AZURE' | 'ALIYUN' | 'LOCAL';
  name: string;
  status: ServiceStatus;
  mode: 'CLOUD' | 'LOCAL';
  detail: string;
  latencyMs: number | null;
  facts: Record<string, string | number | boolean | null>;
}

const METRIC_NAMES = ['api.request', 'callback.latency', 'callback.http', 'callback.handle', 'fc.duration', 'local.processor', 'local.processor.duration', 'oss.put', 'oss.get', 'oss.head', 'oss.list', 'oss.copy', 'oss.delete', 'storage.local.upload', 'storage.sign', 'keyvault.list', 'azure.api'];
const SAFE_QUERY = /^[\p{L}\p{N} _.:\-/@]{0,100}$/u;

function errCode(err: unknown): string {
  if (err instanceof AzureApiError || err instanceof AliyunApiError) return `${err.status || ''} ${err.code}`.trim();
  return (err as Error)?.name ?? 'Error';
}

function notConfiguredError(err: unknown): boolean {
  return (err instanceof AzureApiError || err instanceof AliyunApiError) && (err.code === 'NOT_CONFIGURED' || err.status === 401 || err.status === 403);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { error, ms: Math.round(performance.now() - started) };
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

@Injectable()
export class CloudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly azure: AzureClient,
    private readonly aliyun: AliyunClient,
    private readonly reconciler: MaterialReconciler,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(PROCESSING_DISPATCHER) private readonly dispatcher: ProcessingDispatcher,
  ) {}

  get mode() {
    const cloudStorage = this.storage.kind === 'OSS';
    const cloudProcessing = this.dispatcher.kind === 'ALIYUN_FC';
    return {
      storage: this.storage.kind,
      processing: this.dispatcher.kind,
      onAppService: Boolean(this.config.get('WEBSITE_SITE_NAME')),
      label: cloudStorage && cloudProcessing ? 'CLOUD' : cloudStorage || cloudProcessing ? 'HYBRID' : 'LOCAL',
    };
  }

  private dbHost(): string {
    try {
      return new URL(this.config.get('DATABASE_URL')).hostname;
    } catch {
      return 'unknown';
    }
  }

  /** Last-24h processing statistics from the jobs table (real pipeline data). */
  async pipelineStats(hours = 24) {
    const since = new Date(Date.now() - hours * 3_600_000);
    const jobs = await this.prisma.materialProcessingJob.findMany({ where: { queuedAt: { gte: since } }, select: { status: true, processor: true, durationMs: true, callbackLatencyMs: true, finishedAt: true } });
    const durations = jobs.map((j) => j.durationMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const latencies = jobs.map((j) => j.callbackLatencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const by = (s: ProcessingJobStatus) => jobs.filter((j) => j.status === s).length;
    const finished = jobs.filter((j) => j.finishedAt);
    const lastFinished = finished.sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0]?.finishedAt ?? null;
    const stuck = await this.prisma.material.count({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - this.config.get('PROCESSING_TIMEOUT_SECONDS') * 1000) } } });
    const failed = by('FAILED') + by('TIMED_OUT');
    const done = by('SUCCEEDED') + by('REJECTED') + failed;
    return {
      windowHours: hours,
      total: jobs.length,
      succeeded: by('SUCCEEDED'),
      rejected: by('REJECTED'),
      failed,
      running: by('RUNNING') + by('QUEUED'),
      failureRate: done ? Math.round((failed / done) * 1000) / 10 : 0,
      durationMs: { avg: durations.length ? Math.round(durations.reduce((s, x) => s + x, 0) / durations.length) : null, p50: percentile(durations, 50), p95: percentile(durations, 95), max: durations.at(-1) ?? null },
      callbackLatencyMs: { avg: latencies.length ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : null, p95: percentile(latencies, 95) },
      byProcessor: { ALIYUN_FC: jobs.filter((j) => j.processor === 'ALIYUN_FC').length, LOCAL_MOCK: jobs.filter((j) => j.processor === 'LOCAL_MOCK').length },
      lastFinishedAt: lastFinished,
      stuckMaterials: stuck,
    };
  }

  async overview() {
    const checks: ServiceCheck[] = [];
    const site = this.config.get('WEBSITE_SITE_NAME');
    const appId = this.azure.resourceId('app');
    const pgId = this.azure.resourceId('postgres');

    // ── Azure App Service ──
    const appHealth = site && appId ? await timed(() => this.azure.resourceHealth(appId)) : undefined;
    checks.push(
      site
        ? {
            id: 'app-service',
            provider: 'AZURE',
            name: 'Azure App Service',
            status: appHealth?.value ? (appHealth.value.state === 'Available' ? 'UP' : appHealth.value.state === 'Unavailable' ? 'DOWN' : 'DEGRADED') : 'UP',
            mode: 'CLOUD',
            detail: appHealth?.value ? `Resource Health: ${appHealth.value.state}` : appHealth?.error ? `Đang chạy; Resource Health không đọc được (${errCode(appHealth.error)})` : 'Đang chạy trên App Service',
            latencyMs: appHealth?.ms ?? null,
            facts: { site, instance: (this.config.get('WEBSITE_INSTANCE_ID') ?? '').slice(0, 12) || null, uptimeMinutes: Math.round(process.uptime() / 60), node: process.version },
          }
        : { id: 'app-service', provider: 'LOCAL', name: 'API (NestJS)', status: 'LOCAL', mode: 'LOCAL', detail: 'API đang chạy local — không phải Azure App Service', latencyMs: null, facts: { node: process.version, uptimeMinutes: Math.round(process.uptime() / 60), pid: process.pid } },
    );

    // ── PostgreSQL ──
    const host = this.dbHost();
    const azurePg = host.endsWith('.postgres.database.azure.com');
    const db = await timed(() => this.prisma.$queryRaw<{ version: string; user: string; ssl: boolean | null }[]>`SELECT current_setting('server_version') AS version, current_user AS user, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`);
    const dbRow = db.value?.[0];
    checks.push({
      id: 'postgresql',
      provider: azurePg ? 'AZURE' : 'LOCAL',
      name: azurePg ? 'Azure Database for PostgreSQL' : 'PostgreSQL (Docker local)',
      status: db.value ? 'UP' : 'DOWN',
      mode: azurePg ? 'CLOUD' : 'LOCAL',
      detail: db.value ? `PostgreSQL ${dbRow?.version}, role ${dbRow?.user}, TLS ${dbRow?.ssl ? 'bật' : 'tắt'}` : `Không kết nối được (${errCode(db.error)})`,
      latencyMs: db.ms,
      facts: { host, version: dbRow?.version ?? null, role: dbRow?.user ?? null, tls: dbRow?.ssl ?? null, poolMax: this.config.get('DB_CONNECTION_LIMIT') },
    });

    // ── Key Vault + Managed Identity ──
    const kvUrl = this.config.get('AZURE_KEY_VAULT_URL');
    const kv = kvUrl ? await timed(() => this.azure.secretsMetadata()) : undefined;
    checks.push(
      kvUrl
        ? { id: 'key-vault', provider: 'AZURE', name: 'Azure Key Vault', status: kv?.value ? 'UP' : 'DOWN', mode: 'CLOUD', detail: kv?.value ? `${kv.value.length} secret (chỉ đọc metadata)` : `Không truy cập được (${errCode(kv?.error)})`, latencyMs: kv?.ms ?? null, facts: { vault: new URL(kvUrl).host, expiringSoon: kv?.value?.filter((s) => s.daysToExpiry !== null && s.daysToExpiry < 30).length ?? null } }
        : { id: 'key-vault', provider: 'LOCAL', name: 'Azure Key Vault', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chưa cấu hình AZURE_KEY_VAULT_URL — secrets đọc từ .env (LOCAL MODE)', latencyMs: null, facts: {} },
    );
    checks.push(
      site
        ? { id: 'managed-identity', provider: 'AZURE', name: 'Managed Identity', status: kv?.value ? 'UP' : kvUrl ? 'DEGRADED' : 'NOT_CONFIGURED', mode: 'CLOUD', detail: kv?.value ? 'System-assigned identity lấy token và đọc Key Vault thành công' : kvUrl ? 'Identity chưa có quyền Key Vault (Key Vault Secrets User)' : 'Chưa có tài nguyên để kiểm tra', latencyMs: null, facts: { type: 'SystemAssigned' } }
        : { id: 'managed-identity', provider: 'LOCAL', name: 'Managed Identity', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chỉ có trên App Service', latencyMs: null, facts: {} },
    );

    // ── Application Insights / Azure Monitor ──
    checks.push(
      appInsightsClient()
        ? { id: 'app-insights', provider: 'AZURE', name: 'Application Insights', status: 'UP', mode: 'CLOUD', detail: 'SDK đang gửi requests, dependencies, exceptions và custom metrics', latencyMs: null, facts: { role: 'educenter-api' } }
        : { id: 'app-insights', provider: 'LOCAL', name: 'Application Insights', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chưa có APPLICATIONINSIGHTS_CONNECTION_STRING — chỉ có metrics in-process', latencyMs: null, facts: {} },
    );
    const mon = appId ? await timed(() => this.azure.metrics(appId, ['Requests'], 'PT1H', 'PT1H')) : undefined;
    checks.push(
      appId
        ? { id: 'azure-monitor', provider: 'AZURE', name: 'Azure Monitor', status: mon?.value ? 'UP' : notConfiguredError(mon?.error) ? 'NOT_CONFIGURED' : 'DOWN', mode: 'CLOUD', detail: mon?.value ? `Đọc metrics thành công (${mon.value[0]?.points.reduce((s, p) => s + (p.total ?? 0), 0) ?? 0} requests/giờ)` : `Không đọc được metrics (${errCode(mon?.error)})`, latencyMs: mon?.ms ?? null, facts: { postgresMonitored: Boolean(pgId) } }
        : { id: 'azure-monitor', provider: 'LOCAL', name: 'Azure Monitor', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chưa cấu hình AZURE_SUBSCRIPTION_ID / AZURE_RESOURCE_GROUP / AZURE_APP_SERVICE_NAME', latencyMs: null, facts: {} },
    );

    // ── OSS ──
    const buckets = await timed(() => this.storage.health());
    for (const role of ['quarantine', 'published'] as const) {
      const b = buckets.value?.find((x) => x.role === role);
      const label = role === 'quarantine' ? 'OSS Quarantine' : 'OSS Published';
      checks.push(
        this.storage.kind === 'OSS'
          ? { id: `oss-${role}`, provider: 'ALIYUN', name: label, status: b?.ok ? 'UP' : 'DOWN', mode: 'CLOUD', detail: b?.detail ?? `Lỗi (${errCode(buckets.error)})`, latencyMs: b?.latencyMs ?? null, facts: { bucket: b?.name ?? this.storage.bucketName(role), versioning: b?.versioning ?? null, lifecycleRules: b?.lifecycle.length ?? 0 } }
          : { id: `oss-${role}`, provider: 'LOCAL', name: `${label} (MOCK)`, status: b?.ok ? 'MOCK' : 'DOWN', mode: 'LOCAL', detail: `Mô phỏng bằng hệ thống tệp: ${b?.detail ?? ''}`, latencyMs: b?.latencyMs ?? null, facts: { bucket: this.storage.bucketName(role) } },
      );
    }

    // ── Function Compute + pipeline ──
    const stats = await this.pipelineStats(24);
    const fcName = this.config.get('ALIYUN_FC_FUNCTION_NAME');
    checks.push(
      this.dispatcher.kind === 'ALIYUN_FC'
        ? { id: 'function-compute', provider: 'ALIYUN', name: 'Function Compute', status: stats.total === 0 ? 'UP' : stats.failureRate > 50 ? 'DOWN' : stats.failureRate > 20 ? 'DEGRADED' : 'UP', mode: 'CLOUD', detail: stats.total ? `${stats.succeeded}/${stats.total} job thành công trong 24h, p95 ${stats.durationMs.p95 ?? '-'} ms` : 'Chưa có job trong 24h (trạng thái suy ra từ callback)', latencyMs: null, facts: { function: fcName ?? null, failureRate: stats.failureRate } }
        : { id: 'function-compute', provider: 'LOCAL', name: 'Function Compute (MOCK)', status: 'MOCK', mode: 'LOCAL', detail: 'Bộ xử lý LOCAL trong tiến trình API mô phỏng FC — không phải dịch vụ cloud', latencyMs: null, facts: { jobs24h: stats.byProcessor.LOCAL_MOCK } },
    );

    // ── SLS / CloudMonitor ──
    const sls = this.aliyun.slsConfigured ? await timed(() => this.aliyun.slsLogs('*', Math.floor(Date.now() / 1000) - 900, Math.floor(Date.now() / 1000), 1)) : undefined;
    checks.push(
      this.aliyun.slsConfigured
        ? { id: 'sls', provider: 'ALIYUN', name: 'Simple Log Service', status: sls?.value ? 'UP' : 'DOWN', mode: 'CLOUD', detail: sls?.value ? 'Truy vấn logstore thành công' : `Không truy vấn được (${errCode(sls?.error)})`, latencyMs: sls?.ms ?? null, facts: { project: this.config.get('ALIYUN_SLS_PROJECT') ?? null, logstore: this.config.get('ALIYUN_SLS_LOGSTORE') ?? null } }
        : { id: 'sls', provider: 'LOCAL', name: 'Simple Log Service', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chưa cấu hình SLS — Cloud Logs dùng ops log trong PostgreSQL', latencyMs: null, facts: {} },
    );
    const cms = this.aliyun.monitorConfigured ? await timed(() => this.aliyun.alarmRules('acs_fc')) : undefined;
    checks.push(
      this.aliyun.monitorConfigured
        ? { id: 'cloudmonitor', provider: 'ALIYUN', name: 'CloudMonitor', status: cms?.value ? (cms.value.some((a) => a.state === 'ALARM') ? 'DEGRADED' : 'UP') : 'DOWN', mode: 'CLOUD', detail: cms?.value ? `${cms.value.length} alarm rule, ${cms.value.filter((a) => a.state === 'ALARM').length} đang cảnh báo` : `Không truy vấn được (${errCode(cms?.error)})`, latencyMs: cms?.ms ?? null, facts: {} }
        : { id: 'cloudmonitor', provider: 'LOCAL', name: 'CloudMonitor', status: 'NOT_CONFIGURED', mode: 'LOCAL', detail: 'Chưa cấu hình tài khoản RAM chỉ đọc', latencyMs: null, facts: {} },
    );

    const pipelineStatus: ServiceStatus = stats.stuckMaterials > 0 || stats.failureRate > 20 ? 'DEGRADED' : 'UP';
    checks.push({
      id: 'pipeline',
      provider: this.mode.label === 'LOCAL' ? 'LOCAL' : 'ALIYUN',
      name: 'Cross-cloud pipeline',
      status: this.mode.label === 'LOCAL' && pipelineStatus === 'UP' ? 'MOCK' : pipelineStatus,
      mode: this.mode.label === 'LOCAL' ? 'LOCAL' : 'CLOUD',
      detail: `${stats.total} job/24h · ${stats.failed} lỗi · ${stats.stuckMaterials} tài liệu treo · callback TB ${stats.callbackLatencyMs.avg ?? '-'} ms`,
      latencyMs: null,
      facts: { mode: this.mode.label, lastFinishedAt: stats.lastFinishedAt?.toISOString() ?? null },
    });

    const summary = { up: 0, degraded: 0, down: 0, notConfigured: 0, mock: 0, local: 0 };
    for (const c of checks) {
      if (c.status === 'UP') summary.up += 1;
      else if (c.status === 'DEGRADED') summary.degraded += 1;
      else if (c.status === 'DOWN') summary.down += 1;
      else if (c.status === 'NOT_CONFIGURED') summary.notConfigured += 1;
      else if (c.status === 'MOCK') summary.mock += 1;
      else summary.local += 1;
    }
    return { checkedAt: new Date(), mode: this.mode, summary, services: checks, pipeline: stats };
  }

  async storageView(p: Principal, role: BucketRole, prefix: string, limit: number) {
    if (prefix && !/^[A-Za-z0-9/_.-]{0,200}$/.test(prefix)) throw badRequest('prefix không hợp lệ', 'prefix');
    const scopedPrefix = prefix || (role === 'quarantine' ? `quarantine/${p.tenantId}/` : '');
    const [listing, health, byStatus, readyBytes, recent] = await Promise.all([
      timed(() => this.storage.list(role, scopedPrefix, limit)),
      timed(() => this.storage.health()),
      this.prisma.material.groupBy({ by: ['status'], where: { tenantId: p.tenantId }, _count: true, _sum: { sizeBytes: true } }),
      this.prisma.material.aggregate({ where: { tenantId: p.tenantId, status: 'READY' }, _sum: { sizeBytes: true }, _count: true }),
      this.prisma.material.findMany({ where: { tenantId: p.tenantId }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, title: true, status: true, originalFilename: true, sizeBytes: true, declaredSize: true, uploadedBy: true, createdAt: true, sourceVersionId: true, storageProvider: true } }),
    ]);
    const objects = listing.value?.objects ?? [];
    // Attach the owning material (keys embed tenant + material id).
    const ids = [...new Set(objects.map((o) => materialIdFromKey(o.key)).filter((x): x is string => !!x))];
    const mats = ids.length ? await this.prisma.material.findMany({ where: { tenantId: p.tenantId, id: { in: ids } }, select: { id: true, title: true, status: true, sourceVersionId: true } }) : [];
    const byId = new Map(mats.map((m) => [m.id, m]));
    return {
      provider: this.storage.kind,
      bucket: { role, name: this.storage.bucketName(role), health: health.value?.find((h) => h.role === role) ?? null },
      prefix: scopedPrefix,
      listingError: listing.error ? errCode(listing.error) : null,
      truncated: listing.value?.truncated ?? false,
      usage: { objects: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0) },
      objects: objects.map((o) => {
        const id = materialIdFromKey(o.key);
        return { ...o, material: id ? byId.get(id) ?? null : null };
      }),
      database: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count, bytes: s._sum.sizeBytes ?? 0 })),
        readyCount: readyBytes._count,
        readyBytes: readyBytes._sum.sizeBytes ?? 0,
      },
      uploadHistory: recent,
      policies: {
        maxUploadBytes: this.config.get('UPLOAD_MAX_BYTES'),
        uploadPolicyTtlSeconds: this.config.get('UPLOAD_POLICY_TTL_SECONDS'),
        signedUrlTtlSeconds: this.config.get('SIGNED_URL_TTL_SECONDS'),
        uploadExpirySeconds: this.config.get('UPLOAD_EXPIRY_SECONDS'),
      },
    };
  }

  async jobs(p: Principal, q: { status?: ProcessingJobStatus; processor?: 'ALIYUN_FC' | 'LOCAL_MOCK'; q?: string; page: number; pageSize: number }) {
    const search = q.q?.trim();
    const where: Prisma.MaterialProcessingJobWhereInput = {
      tenantId: p.tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.processor ? { processor: q.processor } : {}),
      ...(search ? { OR: [{ correlationId: { contains: search } }, { material: { title: { contains: search, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.materialProcessingJob.findMany({ where, orderBy: { queuedAt: 'desc' }, ...pageArgs(q), include: { material: { select: { id: true, title: true, status: true, originalFilename: true, sizeBytes: true, pageCount: true } } } }),
      this.prisma.materialProcessingJob.count({ where }),
    ]);
    return { ...toPage(rows, total, q), stats: await this.pipelineStats(24) };
  }

  async jobEvents(p: Principal, jobId: string) {
    const job = await this.prisma.materialProcessingJob.findFirst({ where: { tenantId: p.tenantId, id: jobId }, include: { material: { select: { id: true, title: true, status: true } } } });
    if (!job) return null;
    const [events, logs] = await Promise.all([
      this.prisma.materialProcessingEvent.findMany({ where: { tenantId: p.tenantId, materialId: job.materialId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.opsLogEntry.findMany({ where: { OR: [{ correlationId: job.correlationId }, { materialId: job.materialId }] }, orderBy: { createdAt: 'asc' }, take: 200 }),
    ]);
    return { job, events, logs };
  }

  reconcilerRuns() {
    return this.prisma.backgroundJobRun.findMany({ where: { name: 'material-reconciler' }, orderBy: { startedAt: 'desc' }, take: 20 });
  }

  runReconcile() {
    return this.reconciler.runOnce('MANUAL');
  }

  async metricsView(windowMinutes: number) {
    const inProcess = METRIC_NAMES.map((n) => this.metrics.summary(n, windowMinutes)).filter((m) => m.count > 0 || m.name === 'api.request');
    const dbStats = await timed(() =>
      this.prisma.$queryRaw<{ backends: number; commits: bigint; rollbacks: bigint; blks_hit: bigint; blks_read: bigint; deadlocks: bigint; size_bytes: bigint }[]>`
        SELECT numbackends AS backends, xact_commit AS commits, xact_rollback AS rollbacks, blks_hit, blks_read, deadlocks, pg_database_size(current_database()) AS size_bytes
        FROM pg_stat_database WHERE datname = current_database()`,
    );
    const d = dbStats.value?.[0];
    const appId = this.azure.resourceId('app');
    const pgId = this.azure.resourceId('postgres');
    const fcName = this.config.get('ALIYUN_FC_FUNCTION_NAME');
    const [appMetrics, pgMetrics, fcMetrics, pipeline, storage] = await Promise.all([
      appId ? timed(() => this.azure.metrics(appId, ['Requests', 'Http5xx', 'HttpResponseTime', 'CpuTime', 'MemoryWorkingSet'])) : Promise.resolve(undefined),
      pgId ? timed(() => this.azure.metrics(pgId, ['cpu_percent', 'memory_percent', 'active_connections', 'storage_percent'])) : Promise.resolve(undefined),
      fcName && this.aliyun.monitorConfigured
        ? timed(async () => {
            const dims = { region: this.config.get('ALIYUN_REGION')!, functionName: fcName };
            const [inv, err, lat] = await Promise.all([this.aliyun.metricList('acs_fc', 'FunctionTotalInvocations', dims), this.aliyun.metricList('acs_fc', 'FunctionErrorInvocations', dims), this.aliyun.metricList('acs_fc', 'FunctionLatencyAvg', dims)]);
            return { invocations: inv, errors: err, latencyAvgMs: lat };
          })
        : Promise.resolve(undefined),
      this.pipelineStats(24),
      this.prisma.material.aggregate({ where: { status: { not: 'DELETED' } }, _sum: { sizeBytes: true }, _count: true }),
    ]);
    const external = <T>(r: { value?: T; error?: unknown; ms: number } | undefined, what: string) => (r === undefined ? { status: 'NOT_CONFIGURED' as const, note: `${what} chưa được cấu hình` } : r.value ? { status: 'OK' as const, data: r.value, latencyMs: r.ms } : { status: notConfiguredError(r.error) ? ('NOT_CONFIGURED' as const) : ('ERROR' as const), note: errCode(r.error) });
    return {
      windowMinutes,
      instance: { startedAt: this.metrics.startedAt, appInsights: Boolean(appInsightsClient()) },
      inProcess,
      pipeline,
      database: d ? { backends: d.backends, commits: Number(d.commits), rollbacks: Number(d.rollbacks), cacheHitRatio: Number(d.blks_hit + d.blks_read) ? Math.round((Number(d.blks_hit) / Number(d.blks_hit + d.blks_read)) * 1000) / 10 : null, deadlocks: Number(d.deadlocks), sizeBytes: Number(d.size_bytes), pingMs: dbStats.ms } : null,
      storage: { materials: storage._count, bytes: storage._sum.sizeBytes ?? 0 },
      azureMonitor: { appService: external(appMetrics, 'Azure Monitor (App Service)'), postgres: external(pgMetrics, 'Azure Monitor (PostgreSQL)') },
      cloudMonitor: { functionCompute: external(fcMetrics, 'CloudMonitor (Function Compute)') },
    };
  }

  async logs(p: Principal, q: { source?: 'app' | 'sls' | 'azure'; provider?: CloudProvider; service?: string; level?: LogLevel; from?: string; to?: string; q?: string; correlationId?: string; page: number; pageSize: number }) {
    if (q.q && !SAFE_QUERY.test(q.q)) throw badRequest('Từ khóa chỉ được chứa chữ, số, khoảng trắng và . _ : - / @', 'q');
    if (q.correlationId && !/^[A-Za-z0-9:._-]{1,64}$/.test(q.correlationId)) throw badRequest('correlationId không hợp lệ', 'correlationId');
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 24 * 3_600_000);
    const to = q.to ? new Date(q.to) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw badRequest('Khoảng thời gian không hợp lệ', 'from');
    const source = q.source ?? 'app';

    if (source === 'sls') {
      if (!this.aliyun.slsConfigured) return { source, status: 'NOT_CONFIGURED', note: 'Chưa cấu hình ALIYUN_SLS_PROJECT / LOGSTORE / tài khoản RAM chỉ đọc', items: [] };
      const terms = [q.q ? `"${q.q.replace(/"/g, '')}"` : '', q.correlationId ? `correlationId: "${q.correlationId}"` : '', q.level === 'ERROR' ? 'level: ERROR' : ''].filter(Boolean).join(' and ') || '*';
      const r = await timed(() => this.aliyun.slsLogs(terms, Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000), q.pageSize));
      if (!r.value) return { source, status: 'ERROR', note: errCode(r.error), items: [] };
      return { source, status: 'OK', latencyMs: r.ms, items: r.value.map((l) => ({ time: l.__time__ ? new Date(Number(l.__time__) * 1000).toISOString() : null, level: l.level ?? null, message: l.message ?? l.content ?? JSON.stringify(l).slice(0, 500), correlationId: l.correlationId ?? null, source: l.__source__ ?? null })) };
    }

    if (source === 'azure') {
      if (!this.config.get('AZURE_LOG_ANALYTICS_WORKSPACE_ID')) return { source, status: 'NOT_CONFIGURED', note: 'Chưa cấu hình AZURE_LOG_ANALYTICS_WORKSPACE_ID', items: [] };
      // Values are pre-validated against a strict allowlist, so they cannot break out of the KQL string literal.
      const filters = [q.q ? `| where Message has '${q.q}'` : '', q.correlationId ? `| where Message has '${q.correlationId}'` : '', q.level === 'ERROR' ? '| where SeverityLevel >= 3' : ''].join(' ');
      const kql = `AppTraces | where AppRoleName == 'educenter-api' ${filters} | project TimeGenerated, SeverityLevel, Message, OperationId | top ${q.pageSize} by TimeGenerated desc`;
      const r = await timed(() => this.azure.logQuery(kql, `${from.toISOString()}/${to.toISOString()}`));
      if (!r.value) return { source, status: notConfiguredError(r.error) ? 'NOT_CONFIGURED' : 'ERROR', note: errCode(r.error), items: [] };
      return { source, status: 'OK', latencyMs: r.ms, items: r.value.map((l) => ({ time: String(l.TimeGenerated ?? ''), level: String(l.SeverityLevel ?? ''), message: String(l.Message ?? '').slice(0, 1000), correlationId: String(l.OperationId ?? '') })) };
    }

    const where: Prisma.OpsLogEntryWhereInput = {
      AND: [
        // BUG-02: platform rows (no tenant) are shared only when they name no material.
        { OR: [{ tenantId: p.tenantId }, { tenantId: null, materialId: null }] },
        { createdAt: { gte: from, lte: to } },
        q.provider ? { provider: q.provider } : {},
        q.service ? { service: q.service } : {},
        q.level ? { level: q.level } : {},
        q.correlationId ? { correlationId: q.correlationId } : {},
        q.q ? { OR: [{ message: { contains: q.q, mode: 'insensitive' } }, { event: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total, services] = await Promise.all([
      this.prisma.opsLogEntry.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.opsLogEntry.count({ where }),
      this.prisma.opsLogEntry.groupBy({ by: ['provider', 'service'], _count: true, where: { createdAt: { gte: from, lte: to }, OR: [{ tenantId: p.tenantId }, { tenantId: null, materialId: null }] } }),
    ]);
    return { source, status: 'OK', ...toPage(rows, total, q), facets: services.map((s) => ({ provider: s.provider, service: s.service, count: s._count })) };
  }

  async resources() {
    const kvUrl = this.config.get('AZURE_KEY_VAULT_URL');
    const secrets = kvUrl ? await timed(() => this.azure.secretsMetadata()) : undefined;
    const region = this.config.get('ALIYUN_REGION');
    const item = (provider: 'AZURE' | 'ALIYUN' | 'LOCAL', type: string, name: string | null | undefined, detail: string, configured = Boolean(name)) => ({ provider, type, name: name ?? null, detail, configured });
    return {
      mode: this.mode,
      azure: [
        item('AZURE', 'Resource Group', this.config.get('AZURE_RESOURCE_GROUP'), 'rg-educenter-demo · Southeast Asia (D-09)'),
        item('AZURE', 'App Service (Linux, Node 24)', this.config.get('AZURE_APP_SERVICE_NAME') ?? this.config.get('WEBSITE_SITE_NAME'), 'Host NestJS + SPA cùng origin, health check /api/v1/health, system-assigned identity'),
        item('AZURE', 'PostgreSQL Flexible Server 16', this.config.get('AZURE_POSTGRES_SERVER_NAME'), 'TLS bắt buộc, role edu_migrator / edu_runtime, backup 7 ngày'),
        item('AZURE', 'Key Vault', kvUrl ? new URL(kvUrl).host : null, 'RBAC: identity App Service có Key Vault Secrets User'),
        item('AZURE', 'Application Insights', appInsightsClient() ? 'educenter-api' : null, 'Workspace-based, nhận telemetry từ SDK', Boolean(appInsightsClient())),
        item('AZURE', 'Log Analytics Workspace', this.config.get('AZURE_LOG_ANALYTICS_WORKSPACE_ID') ? 'configured' : null, 'Nguồn KQL cho Cloud Logs / diagnostics'),
      ],
      aliyun: [
        item('ALIYUN', 'Region', region, 'ap-southeast-1 (Singapore, D-09)'),
        item('ALIYUN', 'OSS bucket (quarantine, private, versioning)', this.config.get('OSS_QUARANTINE_BUCKET'), 'Nhận upload trực tiếp, lifecycle xóa sau 1 ngày (cả phiên bản cũ)'),
        item('ALIYUN', 'OSS bucket (published, private, versioning)', this.config.get('OSS_PUBLISHED_BUCKET'), 'Tài liệu đã xử lý + preview + results JSON, tải bằng signed URL'),
        item('ALIYUN', 'Function Compute 3.0 (Python 3.10)', this.config.get('ALIYUN_FC_FUNCTION_NAME'), 'material-processor, OSS trigger ObjectCreated trên quarantine'),
        item('ALIYUN', 'RAM role (FC execution)', this.config.get('ALIYUN_FC_FUNCTION_NAME') ? 'educenter-fc-worker' : null, 'Đọc quarantine, ghi published, ghi SLS — không quyền khác'),
        item('ALIYUN', 'RAM user (API)', this.config.get('OSS_ACCESS_KEY_ID') ? 'api-storage' : null, 'Ký upload policy / signed URL, head/list/delete — không phải root'),
        item('ALIYUN', 'RAM user (read-only ops)', this.config.get('ALIYUN_READONLY_ACCESS_KEY_ID') ? 'educenter-ops-readonly' : null, 'SLS + CloudMonitor (+ BSS) chỉ đọc'),
        item('ALIYUN', 'SLS project / logstore', this.config.get('ALIYUN_SLS_PROJECT') ? `${this.config.get('ALIYUN_SLS_PROJECT')} / ${this.config.get('ALIYUN_SLS_LOGSTORE')}` : null, 'Log của Function Compute (JSON, có correlationId)'),
      ],
      local: [
        item('LOCAL', 'PostgreSQL 16 (Docker)', this.dbHost().endsWith('.postgres.database.azure.com') ? null : this.dbHost(), 'docker compose, 127.0.0.1 only'),
        item('LOCAL', 'Local storage (MOCK OSS)', this.storage.kind === 'LOCAL' ? this.config.get('LOCAL_STORAGE_DIR') : null, 'Thư mục .data/storage'),
        item('LOCAL', 'Local processor (MOCK FC)', this.dispatcher.kind === 'LOCAL_MOCK' ? 'in-process' : null, 'pdf-lib, cùng hợp đồng callback HMAC'),
      ],
      secrets: kvUrl ? (secrets?.value ? { status: 'OK', items: secrets.value } : { status: 'ERROR', note: errCode(secrets?.error), items: [] }) : { status: 'NOT_CONFIGURED', note: 'Không có Key Vault — secrets nằm trong .env (local)', items: [] },
      security: {
        demoMode: this.config.get('DEMO_MODE'),
        hmacKeyIds: [...this.config.get('CALLBACK_HMAC_KEYS').split(',').map((p) => p.split(':')[0])],
        activeHmacKeyId: this.config.get('CALLBACK_HMAC_ACTIVE_KEY_ID'),
        opsNetworkRestricted: Boolean(this.config.get('OPS_ALLOWED_CIDRS')),
      },
    };
  }

  async cost() {
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const az = this.azure.armConfigured ? await timed(() => this.azure.costByService()) : undefined;
    const ali = this.aliyun.monitorConfigured ? await timed(() => this.aliyun.billOverview(cycle)) : undefined;
    const block = (r: typeof az, what: string) =>
      r === undefined
        ? { status: 'NOT_CONFIGURED' as const, note: `${what}: chưa cấu hình truy cập billing`, items: [] as { service: string; cost: number; currency: string }[], total: null }
        : r.value
          ? { status: 'OK' as const, note: null, items: r.value.sort((a, b) => b.cost - a.cost), total: Math.round(r.value.reduce((s, x) => s + x.cost, 0) * 100) / 100, currency: r.value[0]?.currency ?? null }
          : { status: 'NOT_CONFIGURED' as const, note: `${what}: không có quyền billing (${errCode(r.error)})`, items: [], total: null };
    return { period: cycle, azure: block(az, 'Azure Cost Management'), aliyun: block(ali, 'Alibaba Cloud BSS'), disclaimer: 'Chỉ hiển thị số liệu do API billing của nhà cung cấp trả về; không tự ước tính.' };
  }
}
