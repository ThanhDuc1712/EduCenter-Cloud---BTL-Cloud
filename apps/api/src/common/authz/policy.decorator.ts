import { SetMetadata } from '@nestjs/common';

export const POLICY_METADATA = 'educenter:policy';

/**
 * Policy kinds. Only `public` exists in the foundation; P1-03 adds session-based role/ownership
 * policies (`@Policy(...)`) and `@InternalHmacPolicy()` for /internal routes. Any route without
 * a policy is denied (INV-02).
 */
export type PolicyKind = 'public';

export interface PolicyMetadata {
  kind: PolicyKind;
}

/** Explicitly marks an endpoint as reachable without authentication (e.g. health probes). */
export const PublicPolicy = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PolicyMetadata>(POLICY_METADATA, { kind: 'public' });
