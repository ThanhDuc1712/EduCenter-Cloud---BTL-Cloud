import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Function Compute → Azure callback authentication (INV-08, D-29).
 *   X-Edu-Key-Id:    key identifier (two keys may be valid during rotation)
 *   X-Edu-Timestamp: unix seconds; rejected outside ±CALLBACK_MAX_SKEW_SECONDS
 *   X-Edu-Signature: v1=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
 * The signature covers the exact raw bytes received, compared in constant time. Replay inside
 * the time window is stopped by the unique eventId of the payload.
 */
export const HMAC_HEADERS = { keyId: 'x-edu-key-id', timestamp: 'x-edu-timestamp', signature: 'x-edu-signature' } as const;

export function parseHmacKeys(raw: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) keys.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return keys;
}

export function computeSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function signCallback(keyId: string, secret: string, rawBody: Buffer, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  return { [HMAC_HEADERS.keyId]: keyId, [HMAC_HEADERS.timestamp]: timestamp, [HMAC_HEADERS.signature]: `v1=${computeSignature(secret, timestamp, rawBody)}` };
}

export type HmacFailure = 'MISSING_HEADERS' | 'UNKNOWN_KEY' | 'BAD_TIMESTAMP' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE';

export function verifyCallback(
  keys: Map<string, string>,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  maxSkewSeconds: number,
  now = Date.now(),
): { ok: true; keyId: string; skewSeconds: number } | { ok: false; reason: HmacFailure } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const keyId = one(headers[HMAC_HEADERS.keyId]);
  const timestamp = one(headers[HMAC_HEADERS.timestamp]);
  const signature = one(headers[HMAC_HEADERS.signature]);
  if (!keyId || !timestamp || !signature) return { ok: false, reason: 'MISSING_HEADERS' };
  const secret = keys.get(keyId);
  if (!secret) return { ok: false, reason: 'UNKNOWN_KEY' };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: 'BAD_TIMESTAMP' };
  const skew = Math.floor(now / 1000) - Number(timestamp);
  if (Math.abs(skew) > maxSkewSeconds) return { ok: false, reason: 'STALE_TIMESTAMP' };
  const m = /^v1=([0-9a-f]{64})$/.exec(signature);
  if (!m) return { ok: false, reason: 'BAD_SIGNATURE' };
  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), 'hex');
  const given = Buffer.from(m[1], 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true, keyId, skewSeconds: skew };
}
