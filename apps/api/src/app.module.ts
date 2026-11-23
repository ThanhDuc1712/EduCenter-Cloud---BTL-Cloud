import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './health/health.module';

/**
 * Module registry (owner: TV1, ROADMAP §7.1). Each feature PR adds exactly one import line
 * for its own module below.
 */
@Module({
  imports: [CommonModule, PrismaModule, HealthModule],
})
export class AppModule {}
