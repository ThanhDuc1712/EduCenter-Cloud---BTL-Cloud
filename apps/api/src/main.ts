import 'reflect-metadata';
// Must be first: Application Insights patches http/pg before they are loaded (no-op without a connection string).
import './common/observability/appinsights-bootstrap';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './common/bootstrap/configure-app';
import { AppConfigService } from './common/config/app-config.service';
import { AppLogger } from './common/logging/app-logger';

function fatal(msg: string, err: unknown): never {
  // Config errors list variable names and rules only — never values.
  process.stderr.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'fatal',
      msg,
      errorName: (err as Error)?.name,
      detail: (err as Error)?.message,
    }) + '\n',
  );
  process.exit(1);
}

/** Bounded graceful shutdown: Nest drains in-flight requests; force exit if it takes too long. */
function installShutdownDeadline(timeoutMs: number, logger: AppLogger): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.event('log', 'app.shutdown.started', { signal, timeoutMs }, 'Bootstrap');
      setTimeout(() => {
        logger.event('error', 'app.shutdown.timeout', { timeoutMs }, 'Bootstrap');
        process.exit(1);
      }, timeoutMs).unref();
    });
  }
}

async function bootstrap(): Promise<void> {
  let app: NestExpressApplication;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
      // Structured JSON from the very first line; replaced by the configured instance below.
      logger: new AppLogger(),
      abortOnError: false,
    });
  } catch (err) {
    fatal('Application failed to initialise', err);
  }

  configureApp(app);
  const config = app.get(AppConfigService);
  const logger = app.get(AppLogger);
  installShutdownDeadline(config.get('SHUTDOWN_TIMEOUT_MS'), logger);

  const port = config.get('PORT');
  await app.listen(port);
  logger.event('log', 'app.started', { port, nodeEnv: config.get('NODE_ENV') }, 'Bootstrap');
}

bootstrap().catch((err: unknown) => fatal('Application failed to start', err));
