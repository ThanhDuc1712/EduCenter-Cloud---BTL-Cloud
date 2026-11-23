import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { AppLogger } from '../logging/app-logger';

class DbTimeoutError extends Error {
  override name = 'DbTimeoutError';
}

/**
 * Single PrismaClient per process. Connects as edu_runtime through the pg driver adapter with a
 * bounded pool (`DB_CONNECTION_LIMIT`, keep instances × limit within the pool budget, P0-11).
 * The connection string is never logged.
 * From P1-04 (D-26) business modules must access data only through TenantTx, not this class.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: AppLogger,
  ) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        max: config.get('DB_CONNECTION_LIMIT'),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }),
    });
  }

  /** Readiness probe: `SELECT 1` bounded by DB_HEALTH_TIMEOUT_MS. */
  async ping(): Promise<boolean> {
    const timeoutMs = this.config.get('DB_HEALTH_TIMEOUT_MS');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new DbTimeoutError('db ping timeout')), timeoutMs);
        }),
      ]);
      return true;
    } catch (err) {
      this.logger.event('warn', 'db.ping.failed', { errorName: (err as Error)?.name ?? 'unknown' }, 'PrismaService');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Defence in depth for INV-09/INV-10: the app must not run as a superuser or BYPASSRLS role.
   * Production refuses to start; other environments log a warning. A DB that is down does not
   * block startup (health reports 503 instead).
   */
  async onApplicationBootstrap(): Promise<void> {
    let row: { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    try {
      const rows = await this.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      row = rows[0];
    } catch (err) {
      this.logger.event('warn', 'db.role_check.skipped', { errorName: (err as Error)?.name ?? 'unknown' }, 'PrismaService');
      return;
    }
    if (row && (row.rolsuper || row.rolbypassrls)) {
      const message = 'DATABASE_URL uses a SUPERUSER/BYPASSRLS role; use edu_runtime (D-25)';
      if (this.config.isProduction) throw new Error(message);
      this.logger.warn(message, 'PrismaService');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
