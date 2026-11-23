import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated with AsyncLocalStorage.
 * `tenantId` / `userId` / `role` are populated ONLY by the authentication layer
 * (P1-01/P1-03) from the server-side session — never from body, query or headers (INV-01).
 */
export interface RequestContext {
  readonly requestId: string;
  tenantId?: string;
  userId?: string;
  role?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
