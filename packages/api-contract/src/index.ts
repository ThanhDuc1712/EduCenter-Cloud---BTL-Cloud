import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, operations, paths } from '../generated/schema';

export type { components, operations, paths };
export type Schemas = components['schemas'];

/**
 * Typed API client sinh từ OpenAPI contract.
 * Mặc định gọi same-origin `/api/v1` và gửi kèm cookie phiên (D-03).
 */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
    ...options,
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
