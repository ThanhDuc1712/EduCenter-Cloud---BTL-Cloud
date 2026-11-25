import { Injectable } from '@nestjs/common';
import type { CloudProvider, LogLevel, Prisma } from '../../generated/prisma/client';
import { requestContext } from '../context/request-context';
import { AppLogger } from '../logging/app-logger';
import { PrismaService } from '../prisma/prisma.service';

export interface OpsLogInput {
  provider: CloudProvider;
  /** APP_SERVICE, POSTGRESQL, KEY_VAULT, OSS, FUNCTION_COMPUTE, CALLBACK, RECONCILER, LOCAL_STORAGE, LOCAL_PROCESSOR … */
  service: string;
  level: LogLevel;
  event: string;
  message: string;
  tenantId?: string | null;
  materialId?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  detail?: Record<string, unknown>;
}

const LEVEL_MAP = { DEBUG: 'debug', INFO: 'log', WARN: 'warn', ERROR: 'error' } as const;

/**
 * Operational log of the cross-cloud pipeline. Every entry goes to stdout (→ App Service logs /
 * Application Insights) AND to `ops_log_entries`, which powers the Cloud Logs page even when SLS /
 * Log Analytics are not configured. Never write secrets, signed URLs or file contents here.
 */
@Injectable()
export class OpsLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async write(entry: OpsLogInput): Promise<void> {
    const correlationId = entry.correlationId ?? requestContext.requestId() ?? null;
    this.logger.event(LEVEL_MAP[entry.level], entry.event, { provider: entry.provider, service: entry.service, materialId: entry.materialId, correlationId, durationMs: entry.durationMs, ...(entry.detail ?? {}) }, 'Ops');
    try {
      await this.prisma.opsLogEntry.create({
        data: {
          provider: entry.provider,
          service: entry.service,
          level: entry.level,
          event: entry.event,
          message: entry.message.slice(0, 1000),
          tenantId: entry.tenantId ?? null,
          materialId: entry.materialId ?? null,
          correlationId,
          durationMs: entry.durationMs === undefined || entry.durationMs === null ? null : Math.round(entry.durationMs),
          detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      // Logging must never break the business flow.
      this.logger.event('warn', 'ops_log.write_failed', { errorName: (err as Error)?.name }, 'Ops');
    }
  }
}
