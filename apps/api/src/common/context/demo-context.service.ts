import { HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { Principal } from './principal';

export const PERSONA_COOKIE = 'educenter_persona';
const PERSONA_FORMAT = /^(admin|teacher:[A-Z0-9-]{1,32}|student:[A-Z0-9-]{1,32})$/;
const TENANT_CACHE_MS = 60_000;

interface TenantRow {
  id: string;
  slug: string;
  name: string;
}

/**
 * Demo context (I-01): there is no login. The tenant comes from DEMO_TENANT_SLUG; the persona key
 * is stored in an HMAC-signed HttpOnly cookie and resolved against seeded teacher/student rows,
 * so the role is derived from the database, not chosen freely by the client.
 * Persona switching exists only when DEMO_MODE=true.
 *
 * Since login/registration exist, this context is a fallback used ONLY when AUTH_MODE=demo
 * (a request with a valid login session always uses the session principal instead).
 */
@Injectable()
export class DemoContextService {
  private tenantCache?: { row: TenantRow; at: number };

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** The demo context is used at all (requests without a login session). */
  get enabled(): boolean {
    return this.config.get('AUTH_MODE') === 'demo';
  }

  /** Persona switching is allowed (demo context enabled AND DEMO_MODE=true). */
  get demoMode(): boolean {
    return this.enabled && this.config.get('DEMO_MODE');
  }

  async tenant(): Promise<TenantRow> {
    if (this.tenantCache && Date.now() - this.tenantCache.at < TENANT_CACHE_MS) return this.tenantCache.row;
    const row = await this.prisma.tenant.findUnique({
      where: { slug: this.config.get('DEMO_TENANT_SLUG') },
      select: { id: true, slug: true, name: true },
    });
    if (!row) {
      throw new AppException('TENANT_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE, 'Chưa có dữ liệu trung tâm. Hãy chạy seed (pnpm --filter api db:seed).');
    }
    this.tenantCache = { row, at: Date.now() };
    return row;
  }

  /** Resolves the principal for a request: signed cookie persona (demo mode) or the configured default. */
  async resolve(req: Request): Promise<Principal> {
    const fromCookie = this.demoMode ? this.readCookie(req) : undefined;
    if (fromCookie) {
      const principal = await this.build(fromCookie);
      if (principal) return principal;
    }
    const fallback = await this.build(this.config.get('DEMO_DEFAULT_PERSONA'));
    if (fallback) return fallback;
    return this.build('admin') as Promise<Principal>;
  }

  /** Builds a principal from a persona key, or undefined if the referenced record does not exist / is inactive. */
  async build(personaKey: string): Promise<Principal | undefined> {
    if (!PERSONA_FORMAT.test(personaKey)) return undefined;
    const tenant = await this.tenant();
    const base = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name, personaKey, authMethod: 'demo' as const };
    if (personaKey === 'admin') return { ...base, role: 'ADMIN', displayName: 'Quản trị trung tâm' };

    const [kind, code] = personaKey.split(':') as ['teacher' | 'student', string];
    if (kind === 'teacher') {
      const t = await this.prisma.teacher.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code } }, select: { id: true, fullName: true, status: true } });
      if (!t || t.status === 'INACTIVE') return undefined;
      return { ...base, role: 'TEACHER', displayName: t.fullName, teacherId: t.id };
    }
    const s = await this.prisma.student.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code } }, select: { id: true, fullName: true, status: true } });
    if (!s || s.status === 'ARCHIVED') return undefined;
    return { ...base, role: 'STUDENT', displayName: s.fullName, studentId: s.id };
  }

  async switchPersona(res: Response, personaKey: string): Promise<Principal> {
    if (!this.demoMode) throw new AppException('DEMO_MODE_DISABLED', HttpStatus.FORBIDDEN, 'Chuyển vai trò demo đã bị tắt trên môi trường này');
    const principal = await this.build(personaKey);
    if (!principal) throw new AppException('PERSONA_NOT_FOUND', HttpStatus.NOT_FOUND, 'Không tìm thấy hồ sơ demo tương ứng');
    res.cookie(PERSONA_COOKIE, `${Buffer.from(personaKey).toString('base64url')}.${this.sign(personaKey)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
      path: '/',
      maxAge: 7 * 86_400_000,
    });
    return principal;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.get('DEMO_CONTEXT_SECRET')).update(`persona:${value}`).digest('base64url');
  }

  private readCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name !== PERSONA_COOKIE) continue;
      const [payload, sig] = rest.join('=').split('.');
      if (!payload || !sig) return undefined;
      const value = Buffer.from(payload, 'base64url').toString('utf8');
      const expected = Buffer.from(this.sign(value));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
      return PERSONA_FORMAT.test(value) ? value : undefined;
    }
    return undefined;
  }
}
