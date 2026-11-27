import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@educenter/shared';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import { clientIpMiddleware } from '../http/client-ip';
import { buildHelmetOptions, buildSpaHelmetOptions } from '../http/security-headers';
import { AppLogger } from '../logging/app-logger';

/** D-12: BIGINT money is serialized as a decimal string in JSON. */
function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (!proto.toJSON) proto.toJSON = function (this: bigint) { return this.toString(); };
}

/** OSS bucket origins allowed by the SPA CSP (direct upload + signed downloads). */
export function storageOrigins(config: AppConfigService): string[] {
  const region = config.get('ALIYUN_REGION');
  if (config.get('STORAGE_PROVIDER') !== 'oss' || !region) return [];
  return [config.get('OSS_QUARANTINE_BUCKET'), config.get('OSS_PUBLISHED_BUCKET')]
    .filter((b): b is string => !!b)
    .map((b) => `https://${b}.oss-${region}.aliyuncs.com`);
}

/**
 * Applies the HTTP foundation. Used by main.ts and by e2e tests so both run the same stack.
 * CORS is intentionally NOT enabled: SPA and API are same-origin (D-03); locally Vite proxies /api.
 * The app must be created with `{ bodyParser: false }` — BodyParserMiddleware owns parsing.
 * When WEB_DIST_DIR is set, the built SPA is served from the same origin with its own CSP.
 */
export function configureApp(app: NestExpressApplication): void {
  installBigIntJson();
  const config = app.get(AppConfigService);
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  app.setGlobalPrefix(API_PREFIX);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS'));
  app.disable('x-powered-by');
  // Must run before anything reads req.ip (rate limits, ops allow-list, session audit).
  app.use(clientIpMiddleware);

  const apiHelmet = helmet(buildHelmetOptions());
  const spaHelmet = helmet(buildSpaHelmetOptions(storageOrigins(config)));
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith(`/${API_PREFIX}/`) || req.path === `/${API_PREFIX}` ? apiHelmet : spaHelmet)(req, res, next));

  const webDist = config.get('WEB_DIST_DIR');
  if (webDist) {
    const dir = path.resolve(process.cwd(), webDist);
    const index = path.join(dir, 'index.html');
    if (existsSync(index)) {
      app.useStaticAssets(dir, {
        index: false,
        setHeaders: (res, file) => res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
      });
      // SPA fallback: any non-API GET that accepts HTML gets index.html (client-side routing).
      app.use((req: Request, res: Response, next: NextFunction) => {
        // Paths with a file extension (missing assets) fall through to a normal 404.
        if (req.method !== 'GET' || req.path.startsWith(`/${API_PREFIX}`) || path.extname(req.path) || !req.accepts('html')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        // root option: the dotfile check then applies to 'index.html' only, not to parent folders.
        res.sendFile('index.html', { root: dir });
      });
      logger.event('log', 'spa.static.enabled', { dir: webDist }, 'Bootstrap');
    } else {
      logger.event('warn', 'spa.static.missing', { dir: webDist }, 'Bootstrap');
    }
  }
  app.enableShutdownHooks();
}
