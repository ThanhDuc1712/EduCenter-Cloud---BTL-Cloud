import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DenyByDefaultGuard } from '../authz/deny-by-default.guard';
import { POLICY_METADATA } from '../authz/policy.decorator';
import type { AppConfigService } from '../config/app-config.service';
import type { DemoContextService } from '../context/demo-context.service';
import type { Principal } from '../context/principal';
import { hashPassword, verifyPassword } from './password';
import { readCookie, SessionService, type UserForPrincipal } from './session.service';

describe('password hashing (Argon2id)', () => {
  it('produces a salted PHC string that verifies only the right password', async () => {
    const a = await hashPassword('Secret123');
    const b = await hashPassword('Secret123');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toEqual(b); // random salt
    expect(a).not.toContain('Secret123');
    await expect(verifyPassword('Secret123', a)).resolves.toBe(true);
    await expect(verifyPassword('secret123', a)).resolves.toBe(false);
  });

  it('treats malformed hashes and oversized input as a failed verification', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x'.repeat(129), await hashPassword('x'))).resolves.toBe(false);
  });
});

describe('SessionService.toPrincipal', () => {
  const tenant = { id: 't1', slug: 'hanoi-center', name: 'HN' };
  const base: UserForPrincipal = { id: 'u1', email: 'a@x.vn', role: 'ADMIN', displayName: 'Admin', status: 'ACTIVE', tenant, teacher: null, student: null };

  it('derives role, profile id and persona key from the account', () => {
    expect(SessionService.toPrincipal(base)).toMatchObject({ role: 'ADMIN', personaKey: 'admin', userId: 'u1', authMethod: 'session', tenantId: 't1' });
    const teacher = SessionService.toPrincipal({ ...base, role: 'TEACHER', teacher: { id: 'g1', code: 'GV001', fullName: 'GV', status: 'ACTIVE' } });
    expect(teacher).toMatchObject({ role: 'TEACHER', teacherId: 'g1', personaKey: 'teacher:GV001', displayName: 'GV' });
  });

  it('refuses disabled accounts and inactive / archived profiles', () => {
    expect(SessionService.toPrincipal({ ...base, status: 'DISABLED' })).toBeUndefined();
    expect(SessionService.toPrincipal({ ...base, role: 'TEACHER', teacher: { id: 'g1', code: 'GV001', fullName: 'GV', status: 'INACTIVE' } })).toBeUndefined();
    expect(SessionService.toPrincipal({ ...base, role: 'STUDENT', student: { id: 's1', code: 'HV0001', fullName: 'HV', status: 'ARCHIVED' } })).toBeUndefined();
    expect(SessionService.toPrincipal({ ...base, role: 'STUDENT', student: null })).toBeUndefined();
  });

  it('reads a single cookie value from the Cookie header', () => {
    const req = { headers: { cookie: 'a=1; educenter_session=abc=def; b=2' } } as never;
    expect(readCookie(req, 'educenter_session')).toBe('abc=def');
    expect(readCookie(req, 'missing')).toBeUndefined();
  });
});

describe('DenyByDefaultGuard with login sessions', () => {
  const principal = { tenantId: 't1', role: 'ADMIN', personaKey: 'admin', authMethod: 'session', userId: 'u1' } as Principal;

  function setup(opts: { session?: Principal; demoEnabled: boolean }) {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ kind: 'roles', roles: ['ADMIN'] });
    const demo = { enabled: opts.demoEnabled, resolve: jest.fn().mockResolvedValue({ ...principal, authMethod: 'demo' }) } as unknown as DemoContextService;
    const sessions = { resolve: jest.fn().mockResolvedValue(opts.session) } as unknown as SessionService;
    const config = { get: () => 'http://localhost:5173', isProduction: false } as unknown as AppConfigService;
    const req: Record<string, unknown> = { method: 'GET', header: () => undefined };
    const ctx = { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return { guard: new DenyByDefaultGuard(reflector, demo, sessions, config), ctx, req, demo };
  }

  it('rejects a request without a session with 401 when AUTH_MODE=session', async () => {
    const { guard, ctx } = setup({ demoEnabled: false });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('uses the session principal and never consults the demo context when a session exists', async () => {
    const { guard, ctx, req, demo } = setup({ session: principal, demoEnabled: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.principal).toBe(principal);
    expect(demo.resolve).not.toHaveBeenCalled();
  });

  it('falls back to the demo context only in AUTH_MODE=demo', async () => {
    const { guard, ctx, req } = setup({ demoEnabled: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.principal as Principal).authMethod).toBe('demo');
  });

  it('keeps the policy metadata key stable', () => {
    expect(POLICY_METADATA).toBe('educenter:policy');
  });
});
