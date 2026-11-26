import { Global, type MiddlewareConsumer, Module, type NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ActivityService } from './activity/activity.service';
import { DenyByDefaultGuard } from './authz/deny-by-default.guard';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DemoContextService } from './context/demo-context.service';
import { SessionService } from './auth/session.service';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';
import { validationExceptionFactory } from './errors/validation';
import { BodyParserMiddleware } from './http/body-parser.middleware';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { AppLogger } from './logging/app-logger';
import { MetricsService } from './observability/metrics.service';
import { OpsLogService } from './observability/ops-log.service';
import { TelemetryService } from './observability/telemetry.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenantTx } from './prisma/tenant-tx';
import path from 'node:path';

/**
 * Cross-cutting foundation shared by every feature module: validated config, structured logger,
 * request ID, body parsing, global validation, deny-by-default authorization + login sessions / demo context,
 * tenant transactions, activity log, metrics/telemetry, error filter.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Local dev reads the repo-root .env; real process env (CI, containers, App Service) wins.
      envFilePath: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
      validate: validateEnv,
    }),
    PrismaModule,
  ],
  providers: [
    AppConfigService,
    {
      provide: AppLogger,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const logger = new AppLogger();
        logger.setLevel(config.get('LOG_LEVEL'));
        return logger;
      },
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
    DemoContextService,
    SessionService,
    TenantTx,
    ActivityService,
    MetricsService,
    TelemetryService,
    OpsLogService,
    { provide: APP_GUARD, useClass: DenyByDefaultGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [AppConfigService, AppLogger, DemoContextService, SessionService, TenantTx, ActivityService, MetricsService, TelemetryService, OpsLogService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters: request ID first so every later error/log line carries it.
    consumer.apply(RequestIdMiddleware, BodyParserMiddleware).forRoutes('{*path}');
  }
}
