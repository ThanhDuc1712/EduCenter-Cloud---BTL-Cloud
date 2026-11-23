import { Injectable, type NestMiddleware } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@educenter/shared';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../context/request-context';
import { AppLogger } from '../logging/app-logger';
import { requestPath } from './body-parser.middleware';

const CLIENT_ID_FORMAT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Always generates the request ID server-side (a client-supplied X-Request-ID is only
 * logged as `clientRequestId`, after format checking). Emits one access-log line per request
 * with method, path (no query string — may carry tokens), status and duration.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const clientHeader = req.header(REQUEST_ID_HEADER);
    const clientRequestId = clientHeader && CLIENT_ID_FORMAT.test(clientHeader) ? clientHeader : undefined;
    const started = process.hrtime.bigint();

    requestContext.run({ requestId }, () => {
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        this.logger.event(
          res.statusCode >= 500 ? 'warn' : 'log',
          'request.completed',
          {
            method: req.method,
            path: requestPath(req),
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs * 10) / 10,
            ...(clientRequestId ? { clientRequestId } : {}),
          },
          'Http',
        );
      });
      next();
    });
  }
}
