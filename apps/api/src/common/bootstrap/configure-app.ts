import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@educenter/shared';
import helmet from 'helmet';
import { AppConfigService } from '../config/app-config.service';
import { buildHelmetOptions } from '../http/security-headers';
import { AppLogger } from '../logging/app-logger';

/**
 * Applies the HTTP foundation. Used by main.ts and by e2e tests so both run the same stack.
 * CORS is intentionally NOT enabled: SPA and API are same-origin (D-03); locally Vite proxies /api.
 * The app must be created with `{ bodyParser: false }` — BodyParserMiddleware owns parsing.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);
  app.useLogger(app.get(AppLogger));
  app.setGlobalPrefix(API_PREFIX);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS'));
  app.disable('x-powered-by');
  app.use(helmet(buildHelmetOptions()));
  app.enableShutdownHooks();
}
