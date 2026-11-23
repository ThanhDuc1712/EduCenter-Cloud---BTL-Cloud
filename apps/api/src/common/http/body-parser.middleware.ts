import { Injectable, type NestMiddleware } from '@nestjs/common';
import { API_PREFIX, ErrorCode } from '@educenter/shared';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';

export const INTERNAL_PATH_PREFIX = `/${API_PREFIX}/internal/`;

/**
 * Body parsing is owned here (Nest's default parser is disabled in configureApp):
 *  - `/api/v1/internal/*`: raw Buffer, small limit — required for HMAC verification (P0-16, INV-08).
 *  - everything else: JSON only, bounded size. No urlencoded/multipart parsing.
 * Parser errors are re-thrown as AppException so they use the standard error body.
 */
@Injectable()
export class BodyParserMiddleware implements NestMiddleware {
  private readonly json: RequestHandler;
  private readonly raw: RequestHandler;

  constructor(config: AppConfigService) {
    this.json = express.json({ limit: config.get('JSON_BODY_LIMIT'), strict: true });
    this.raw = express.raw({ limit: config.get('INTERNAL_BODY_LIMIT'), type: () => true });
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // originalUrl: req.path is relative to the middleware mount point (global prefix stripped).
    const parser = requestPath(req).startsWith(INTERNAL_PATH_PREFIX) ? this.raw : this.json;
    await new Promise<void>((resolve, reject) => {
      parser(req, res, (err?: unknown) => (err ? reject(mapParserError(err)) : resolve()));
    });
    next();
  }
}

/** Absolute request path without the query string. */
export function requestPath(req: Request): string {
  const url = req.originalUrl ?? req.url;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function mapParserError(err: unknown): unknown {
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.too.large') {
    return new AppException(ErrorCode.PAYLOAD_TOO_LARGE, 413, 'Request body too large');
  }
  if (type === 'entity.parse.failed') {
    return new AppException(ErrorCode.VALIDATION_FAILED, 400, 'Malformed JSON body');
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new AppException(ErrorCode.VALIDATION_FAILED, 400, 'Unsupported body encoding');
  }
  return err;
}
