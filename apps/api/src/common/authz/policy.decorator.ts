import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Principal, Role } from '../context/principal';

export const POLICY_METADATA = 'educenter:policy';

/**
 * Policy kinds. Any route without a policy is denied (INV-02).
 *  - public:        reachable without a principal (health probes).
 *  - roles:         a demo-context principal with one of the listed roles (I-01).
 *  - internal-hmac: service-to-service callback; the handler MUST verify the HMAC signature over the raw body.
 *  - ops:           cloud-operations API — ADMIN role and, in production, caller IP in OPS_ALLOWED_CIDRS (I-02).
 */
export type PolicyKind = 'public' | 'roles' | 'internal-hmac' | 'ops';

export interface PolicyMetadata {
  kind: PolicyKind;
  roles?: Role[];
}

/** Explicitly marks an endpoint as reachable without authentication (e.g. health probes). */
export const PublicPolicy = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PolicyMetadata>(POLICY_METADATA, { kind: 'public' });

/** Requires a resolved principal with one of the roles. Ownership/scope checks stay in the service. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PolicyMetadata>(POLICY_METADATA, { kind: 'roles', roles });

export const AnyRole = (): MethodDecorator & ClassDecorator => Roles('ADMIN', 'TEACHER', 'STUDENT');

/** Function Compute → Azure callback. The guard lets it through; the controller verifies HMAC. */
export const InternalHmacPolicy = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PolicyMetadata>(POLICY_METADATA, { kind: 'internal-hmac' });

export const OpsPolicy = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PolicyMetadata>(POLICY_METADATA, { kind: 'ops', roles: ['ADMIN'] });

/** Injects the principal resolved by the guard. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
  if (!req.principal) throw new Error('CurrentPrincipal used on a route without a roles/ops policy');
  return req.principal;
});
