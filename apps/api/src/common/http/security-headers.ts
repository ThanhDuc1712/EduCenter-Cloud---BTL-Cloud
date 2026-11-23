import type { HelmetOptions } from 'helmet';

/**
 * Single place for HTTP security headers. The CSP below is a strict API default;
 * P1-24 (SPA serving, D-03) extends it — do not set CSP anywhere else (ANH OQ-18).
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
