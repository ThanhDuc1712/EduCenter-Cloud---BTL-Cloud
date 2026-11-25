import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Principal } from '../context/principal';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;
/** Either the root client or an interactive transaction — what helper services accept. */
export type Db = PrismaService | Tx;

/**
 * D-26: business writes run in one interactive transaction that also sets `app.tenant_id`
 * (transaction-local), so enabling RLS later only needs a migration. Every query still filters by
 * `tenantId` explicitly. Never perform network calls (OSS, HTTP) inside the callback.
 */
@Injectable()
export class TenantTx {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(principal: Pick<Principal, 'tenantId'>, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${principal.tenantId}, true)`;
        return fn(tx);
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}

/**
 * Serializes "next code" generation (HV0001, GV001, HD00001 …) per tenant: a transaction-scoped
 * advisory lock, released automatically at commit/rollback.
 */
export async function lockSequence(db: Tx, tenantId: string, name: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${name}`}, 0))`;
}
