import { Injectable, type LoggerService, type LogLevel } from '@nestjs/common';
import { requestContext } from '../context/request-context';
import type { LogLevelName } from '../config/env.validation';

const SEVERITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  log: 3,
  debug: 4,
  verbose: 5,
};

/** Keys whose values are always redacted if a caller passes them in structured fields (INV-05). */
const REDACT = /pass(word)?|secret|token|cookie|authorization|signature|api[-_]?key|access[-_]?key|database_url|connection/i;

export type LogFields = Record<string, unknown>;

/**
 * Structured JSON-lines logger (one object per line on stdout/stderr) with requestId
 * pulled from the request context. Never log bodies, cookies, tokens, signed URLs or PII.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private threshold = SEVERITY.log;

  setLevel(level: LogLevelName): void {
    this.threshold = SEVERITY[level];
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  /** Structured event: `logger.event('log', 'request.completed', { statusCode: 200 })`. */
  event(level: LogLevel, msg: string, fields: LogFields, context?: string): void {
    if (SEVERITY[level] > this.threshold) return;
    this.emit(level, { msg, ...sanitize(fields) }, context);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (SEVERITY[level] > this.threshold) return;
    // Nest convention: last string param is the context; for error(), a stack may precede it.
    const rest = [...params];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const entry: LogFields = {};
    if (message instanceof Error) {
      entry.msg = message.message;
      entry.errorName = message.name;
      if (level === 'error' || level === 'fatal') entry.stack = message.stack;
    } else if (typeof message === 'object' && message !== null) {
      Object.assign(entry, sanitize(message as LogFields));
    } else {
      entry.msg = String(message);
    }
    if ((level === 'error' || level === 'fatal') && typeof rest[0] === 'string') {
      entry.stack = rest[0];
    }
    this.emit(level, entry, context);
  }

  private emit(level: LogLevel, entry: LogFields, context?: string): void {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      requestId: requestContext.requestId(),
      ...entry,
    });
    if (SEVERITY[level] <= SEVERITY.warn) process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }
}

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACT.test(key) ? '[REDACTED]' : value;
  }
  return out;
}
