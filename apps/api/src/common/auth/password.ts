import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id password hashing with Node's built-in implementation (node:crypto, Node ≥ 24.7) —
 * no native add-on. Parameters follow the OWASP minimum (m = 19 MiB, t = 2, p = 1).
 * Hashes are stored as PHC strings so parameters can be raised later without breaking old hashes:
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>
 */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;
/** Upper bound on input size (DoS guard; matches the DTO limit). */
export const PASSWORD_MAX_LENGTH = 128;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');
const unb64 = (s: string) => Buffer.from(s, 'base64');

function derive(password: string, salt: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(key)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;

/** Constant-time verification. A malformed stored hash verifies as false (never throws). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m || password.length > PASSWORD_MAX_LENGTH) return false;
  const expected = unb64(m[5]);
  try {
    const actual = await derive(password, unb64(m[4]), { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: expected.length });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Hash of a random throw-away password: verifying against it when the account does not exist
 * keeps the response time of "unknown email" equal to "wrong password" (no account enumeration).
 */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64'));
  return dummy;
}
