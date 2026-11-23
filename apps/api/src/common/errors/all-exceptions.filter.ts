import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { requestContext } from '../context/request-context';
import { AppLogger } from '../logging/app-logger';
import { AppException, type ErrorBody } from './app-exception';

const STATUS_TO_CODE: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

const SAFE_MESSAGE: Record<string, string> = {
  [ErrorCode.VALIDATION_FAILED]: 'Request validation failed',
  [ErrorCode.UNAUTHENTICATED]: 'Authentication required',
  [ErrorCode.FORBIDDEN]: 'Access denied',
  [ErrorCode.NOT_FOUND]: 'Resource not found',
  [ErrorCode.CONFLICT]: 'Request conflicts with the current state of the resource',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'Request body too large',
  [ErrorCode.TOO_MANY_REQUESTS]: 'Too many requests',
  [ErrorCode.INTERNAL_ERROR]: 'Internal server error',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
};

/** Prisma known-request codes mapped generically — constraint/table names are never exposed. */
const PRISMA_CODE_MAP: Record<string, [HttpStatus, string]> = {
  P2002: [HttpStatus.CONFLICT, ErrorCode.CONFLICT], // unique violation
  P2003: [HttpStatus.CONFLICT, ErrorCode.CONFLICT], // FK violation
  P2025: [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND], // record not found
  P2034: [HttpStatus.CONFLICT, ErrorCode.CONFLICT], // serialization / deadlock
};

const PRISMA_UNAVAILABLE = new Set(['PrismaClientInitializationError', 'PrismaClientRustPanicError']);

interface Resolved {
  status: number;
  body: Omit<ErrorBody, 'requestId'>;
  /** Unexpected errors are logged with stack server-side only. */
  unexpected: boolean;
}

/**
 * Global filter: every error leaves as `{ code, message, requestId, fieldErrors? }` (INV-11).
 * Stack traces, SQL, Prisma metadata and constraint names are logged at most — never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { requestId?: string }>();
    const requestId = requestContext.requestId() ?? req?.requestId ?? randomUUID();

    const resolved = resolve(exception);
    if (resolved.unexpected) {
      this.logger.error(exception instanceof Error ? exception : String(exception), 'AllExceptionsFilter');
    } else if (resolved.status >= 500) {
      this.logger.event('warn', 'request.failed', { code: resolved.body.code, status: resolved.status }, 'AllExceptionsFilter');
    }

    if (res.headersSent) return;
    const body: ErrorBody = { ...resolved.body, requestId };
    res.status(resolved.status).setHeader('Cache-Control', 'no-store').json(body);
  }
}

export function resolve(exception: unknown): Resolved {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      body: {
        code: exception.code,
        message: exception.message,
        ...(exception.fieldErrors?.length ? { fieldErrors: exception.fieldErrors } : {}),
      },
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED);
    // Framework messages can include internals (e.g. route paths) — use the safe catalogue.
    return { status, body: { code, message: SAFE_MESSAGE[code] ?? SAFE_MESSAGE.INTERNAL_ERROR }, unexpected: status >= 500 };
  }

  const name = (exception as { name?: unknown } | null)?.name;
  if (name === 'PrismaClientKnownRequestError') {
    const prismaCode = String((exception as { code?: unknown }).code ?? '');
    const mapped = PRISMA_CODE_MAP[prismaCode];
    if (mapped) {
      const [status, code] = mapped;
      return { status, body: { code, message: SAFE_MESSAGE[code] }, unexpected: false };
    }
  }
  if (typeof name === 'string' && PRISMA_UNAVAILABLE.has(name)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: { code: ErrorCode.SERVICE_UNAVAILABLE, message: SAFE_MESSAGE.SERVICE_UNAVAILABLE },
      unexpected: true,
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: ErrorCode.INTERNAL_ERROR, message: SAFE_MESSAGE.INTERNAL_ERROR },
    unexpected: true,
  };
}
