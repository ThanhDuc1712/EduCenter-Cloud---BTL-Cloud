import type { NextFunction, Request, Response } from 'express';

/**
 * Azure App Service puts the client port into X-Forwarded-For ("1.2.3.4:51234", "[2001:db8::1]:443").
 * With `trust proxy` Express then reports req.ip WITH the port, which breaks every IP-based check
 * (ops allow-list, per-IP login/register limits). Strip the port and the IPv4-mapped prefix.
 */
export function normalizeClientIp(ip: string): string {
  let value = ip.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

/** Makes req.ip the normalized client address for everything downstream. */
export function clientIpMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ip = req.ip;
  if (ip) Object.defineProperty(req, 'ip', { value: normalizeClientIp(ip), configurable: true, enumerable: true });
  next();
}
