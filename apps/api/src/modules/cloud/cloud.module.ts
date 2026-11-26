import { Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentPrincipal, OpsPolicy } from '../../common/authz/policy.decorator';
import { notFound } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto } from '../../common/http/pagination';
import { MaterialsModule } from '../materials/materials.module';
import { MaterialsService } from '../materials/materials.service';
import { AliyunClient } from './aliyun.client';
import { AzureClient } from './azure.client';
import { CloudService } from './cloud.service';

class StorageQueryDto {
  @IsOptional() @IsIn(['quarantine', 'published']) bucket?: 'quarantine' | 'published';
  @IsOptional() @IsString() @MaxLength(200) prefix?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

class JobsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['QUEUED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'TIMED_OUT']) status?: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'TIMED_OUT';
  @IsOptional() @IsIn(['ALIYUN_FC', 'LOCAL_MOCK']) processor?: 'ALIYUN_FC' | 'LOCAL_MOCK';
}

class MetricsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(120) window?: number;
}

class LogsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['app', 'sls', 'azure']) source?: 'app' | 'sls' | 'azure';
  @IsOptional() @IsIn(['AZURE', 'ALIYUN', 'LOCAL']) provider?: 'AZURE' | 'ALIYUN' | 'LOCAL';
  @IsOptional() @IsString() @MaxLength(40) service?: string;
  @IsOptional() @IsIn(['DEBUG', 'INFO', 'WARN', 'ERROR']) level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() @MaxLength(64) correlationId?: string;
}

/**
 * Cloud Operations API (I-02): ADMIN only and, in production, callers must also come from
 * OPS_ALLOWED_CIDRS (on top of App Service access restrictions). Read-only except reconcile/retry.
 */
@Controller('cloud')
@OpsPolicy()
export class CloudController {
  constructor(
    private readonly cloud: CloudService,
    private readonly materials: MaterialsService,
  ) {}

  @Get('overview')
  overview() {
    return this.cloud.overview();
  }

  @Get('storage')
  storage(@CurrentPrincipal() p: Principal, @Query() q: StorageQueryDto) {
    return this.cloud.storageView(p, q.bucket ?? 'published', q.prefix ?? '', q.limit ?? 200);
  }

  @Get('jobs')
  jobs(@CurrentPrincipal() p: Principal, @Query() q: JobsQueryDto) {
    return this.cloud.jobs(p, q);
  }

  @Get('jobs/:id')
  async job(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.cloud.jobEvents(p, id);
    if (!r) throw notFound('job');
    return r;
  }

  @Post('materials/:id/retry')
  retry(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.retry(p, id);
  }

  @Get('reconciler')
  runs() {
    return this.cloud.reconcilerRuns();
  }

  @Post('reconciler/run')
  reconcile() {
    return this.cloud.runReconcile();
  }

  @Get('metrics')
  metrics(@Query() q: MetricsQueryDto) {
    return this.cloud.metricsView(q.window ?? 60);
  }

  @Get('logs')
  logs(@CurrentPrincipal() p: Principal, @Query() q: LogsQueryDto) {
    return this.cloud.logs(p, q);
  }

  @Get('resources')
  resources() {
    return this.cloud.resources();
  }

  @Get('cost')
  cost() {
    return this.cloud.cost();
  }
}

@Module({ imports: [MaterialsModule], controllers: [CloudController], providers: [CloudService, AzureClient, AliyunClient] })
export class CloudModule {}
