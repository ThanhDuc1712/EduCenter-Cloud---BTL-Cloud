import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@educenter/shared';
import { AppException } from '../errors/app-exception';
import { POLICY_METADATA, type PolicyMetadata } from './policy.decorator';

/**
 * Global guard (registered first in the chain). Denies every route that has no explicit
 * policy. Later guards (AuthGuard → TenantContext → RolesGuard → @Policy, P1-03) only ever
 * narrow access further; nothing here grants access based on client input.
 */
@Injectable()
export class DenyByDefaultGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<PolicyMetadata | undefined>(POLICY_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (policy?.kind === 'public') return true;
    throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Access denied');
  }
}
