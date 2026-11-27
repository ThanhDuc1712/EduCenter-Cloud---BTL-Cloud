// Shared HTTP helpers for the black-box QA suites (Node 24, built-in fetch, no dependencies).
// Never prints or stores cookies, tokens or passwords.

export const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const API = `${BASE_URL}/api/v1`;
export const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
// Locally the SPA (Vite) runs on 5173 and the API on 3000; in the cloud both share one origin (D-03).
export const APP_ORIGIN = (process.env.APP_ORIGIN ?? (IS_LOCAL ? 'http://localhost:5173' : new URL(BASE_URL).origin)).replace(/\/$/, '');
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (IS_LOCAL ? 'Demo@12345' : undefined);
export const TENANT_A = process.env.TENANT_A ?? 'hanoi-center';
export const TENANT_B = process.env.TENANT_B ?? 'saigon-center';

/** A logged-in (or anonymous) actor holding its own cookie. */
export class Session {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  /**
   * @param {string} method
   * @param {string} path  path under /api/v1, or absolute URL
   * @param {{ body?: unknown, rawBody?: string, headers?: Record<string,string>, origin?: string|null }} [opts]
   *   origin: undefined → APP_ORIGIN, null → no Origin header, string → that value.
   */
  async call(method, path, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
    if (origin !== null) headers.origin = origin;
    let body;
    if (opts.rawBody !== undefined) {
      body = opts.rawBody;
      headers['content-type'] ??= 'application/json';
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }
    const started = performance.now();
    let res;
    try {
      res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { method, headers, body, redirect: 'manual' });
    } catch (err) {
      return { status: 0, json: null, text: '', headers: new Headers(), setCookies: [], ms: performance.now() - started, error: String(err?.cause?.code ?? err?.message ?? err) };
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const [name, value] = pair.split('=');
      if (/session/i.test(name)) this.cookie = value ? `${name}=${value}` : '';
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers, setCookies, ms: performance.now() - started };
  }

  async login(tenantSlug, email, password = TEST_PASSWORD) {
    const r = await this.call('POST', '/auth/login', { body: { tenantSlug, email, password } });
    return r;
  }

  async logout() {
    return this.call('POST', '/auth/logout');
  }
}

/** Page helper: returns the items array of a `{ items, meta }` response (or [] ). */
export function itemsOf(r) {
  if (!r || r.status !== 200 || !r.json) return [];
  if (Array.isArray(r.json)) return r.json;
  return Array.isArray(r.json.items) ? r.json.items : [];
}

/** Collects every UUID-looking value in a JSON body. */
export function uuidsIn(value) {
  const found = new Set();
  const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const m of JSON.stringify(value ?? null).matchAll(re)) found.add(m[0].toLowerCase());
  return found;
}

export function cookieAttributes(setCookies) {
  const sc = setCookies.find((c) => /session/i.test(c.split('=')[0]));
  if (!sc) return null;
  const parts = sc.split(';').map((p) => p.trim().toLowerCase());
  return {
    name: sc.split('=')[0],
    httpOnly: parts.includes('httponly'),
    secure: parts.includes('secure'),
    sameSite: (parts.find((p) => p.startsWith('samesite=')) ?? '').split('=')[1] ?? '',
  };
}
