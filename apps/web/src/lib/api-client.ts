import type { paths } from '@educenter/api-contract'
import createClient from 'openapi-fetch'

/**
 * The only way the SPA talks to the API (ROADMAP §7.3): a client typed from the OpenAPI contract.
 * Same-origin (D-03): relative base URL, cookies sent only to our own origin, nothing stored
 * in localStorage. CSRF header injection is added by P1-15 once P1-02 defines the token.
 */
export const api = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'same-origin',
})
