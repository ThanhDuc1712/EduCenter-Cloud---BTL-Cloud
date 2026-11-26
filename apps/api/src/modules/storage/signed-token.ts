import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compact HMAC-signed, expiring token used by the LOCAL storage provider to emulate OSS upload
 * policies and signed URLs: `base64url(json).base64url(hmac)`.
 */
export function signToken(secret: Buffer, payload: Record<string, unknown> & { exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T extends { exp: number }>(secret: Buffer, token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
