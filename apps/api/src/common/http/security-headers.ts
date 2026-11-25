import type { HelmetOptions } from 'helmet';

/**
 * Single place for HTTP security headers. The API CSP is a strict default; the SPA CSP (served
 * same-origin by the API in cloud, D-03) allows only our origin plus the OSS bucket hosts needed for
 * direct upload (PostObject) and signed download/preview. Do not set CSP anywhere else.
 */
export function buildHelmetOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 15552000, includeSubDomains: true },
  };
}

/** @param storageOrigins e.g. `https://edu-published.oss-ap-southeast-1.aliyuncs.com` */
export function buildSpaHelmetOptions(storageOrigins: string[]): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', ...storageOrigins],
        'connect-src': ["'self'", ...storageOrigins],
        'frame-src': ["'self'", ...storageOrigins],
        'object-src': ["'none'"],
        'font-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'", ...storageOrigins],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 15552000, includeSubDomains: true },
  };
}
