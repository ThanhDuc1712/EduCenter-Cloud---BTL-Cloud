import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicPolicy } from '../common/authz/policy.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

export interface HealthResponse {
  status: 'ok' | 'error';
  checks: { app: 'up'; database?: 'up' | 'down' };
}

/** Contract: packages/api-contract/paths/health.yaml. Never exposes version, env or hostname. */
@Controller('health')
@PublicPolicy()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Readiness (App Service health check path): app + database. 503 when DB is not ready. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const dbUp = await this.prisma.ping();
    res.status(dbUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: dbUp ? 'ok' : 'error', checks: { app: 'up', database: dbUp ? 'up' : 'down' } };
  }

  /** Liveness: process only, no dependency checks. */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  liveness(): HealthResponse {
    return { status: 'ok', checks: { app: 'up' } };
  }
}
