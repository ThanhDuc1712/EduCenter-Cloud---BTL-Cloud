import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@educenter/shared';
import type { Request } from 'express';
import { BlockList, isIP } from 'node:net';
import { SessionService } from '../auth/session.service';
import { AppConfigService } from '../config/app-config.service';
import { requestContext } from '../context/request-context';
import { DemoContextService } from '../context/demo-context.service';
import type { Principal } from '../context/principal';
import { AppException } from '../errors/app-exception';
import { POLICY_METADATA, type PolicyMetadata } from './policy.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Denies every route that has no explicit policy (INV-02), then applies the policy:
 * the principal is resolved server-side (login session; demo context I-01 only when AUTH_MODE=demo),
 * missing principal → 401 UNAUTHENTICATED — nothing here grants access based on
 * client-supplied tenant/role. Unsafe methods must come from our own origin (same-origin, D-03).
 */
@Injectable()
export class DenyByDefaultGuard implements CanActivate {
  private opsAllowList?: BlockList;

  constructor(
    private readonly reflector: Reflector,
    private readonly demo: DemoContextService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<PolicyMetadata | undefined>(POLICY_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Access denied');
    if (policy.kind === 'internal-hmac') return true;

    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    // Public mutations (login / register / logout) get the same-origin check too (login CSRF).
    this.assertSameOrigin(req);
    if (policy.kind === 'public') return true;

    // A valid login session always wins; the demo context is only a fallback in AUTH_MODE=demo.
    const principal = (await this.sessions.resolve(req)) ?? (this.demo.enabled ? await this.demo.resolve(req) : undefined);
    if (!principal) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'Bạn cần đăng nhập để tiếp tục');
    }
    req.principal = principal;
    const store = requestContext.get();
    if (store) {
      store.tenantId = principal.tenantId;
      store.role = principal.role;
      store.userId = principal.userId ?? principal.personaKey;
    }

    if (!policy.roles?.includes(principal.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Vai trò hiện tại không có quyền thực hiện thao tác này');
    }
    if (policy.kind === 'ops' && this.config.isProduction && !this.ipAllowed(req.ip)) {
      throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Cloud operations API is restricted to the operations network');
    }
    return true;
  }

  private assertSameOrigin(req: Request): void {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.header('origin');
    if (origin && origin !== this.config.get('APP_ORIGIN')) {
      throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Cross-origin request rejected');
    }
  }

  private ipAllowed(ip: string | undefined): boolean {
    if (!ip) return false;
    if (!this.opsAllowList) {
      this.opsAllowList = new BlockList();
      for (const raw of (this.config.get('OPS_ALLOWED_CIDRS') ?? '').split(',')) {
        const cidr = raw.trim();
        if (!cidr) continue;
        const [addr, bits] = cidr.split('/');
        const family = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
        if (bits) this.opsAllowList.addSubnet(addr, Number(bits), family);
        else this.opsAllowList.addAddress(addr, family);
      }
    }
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    return this.opsAllowList.check(normalized, isIP(normalized) === 6 ? 'ipv6' : 'ipv4');
  }
}
