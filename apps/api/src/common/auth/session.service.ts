import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import type { Principal } from '../context/principal';
import { PrismaService } from '../prisma/prisma.service';

/** Writes to `last_seen_at` are throttled: at most one per session per minute. */
const TOUCH_EVERY_MS = 60_000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const USER_INCLUDE = {
  tenant: { select: { id: true, slug: true, name: true } },
  teacher: { select: { id: true, code: true, fullName: true, status: true } },
  student: { select: { id: true, code: true, fullName: true, status: true } },
} as const;

export interface UserForPrincipal {
  id: string;
  email: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  tenant: { id: string; slug: string; name: string };
  teacher: { id: string; code: string; fullName: string; status: string } | null;
  student: { id: string; code: string; fullName: string; status: string } | null;
}

export type SessionRequest = Request & { authSessionId?: string };

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0 || part.slice(0, idx).trim() !== name) continue;
    return part.slice(idx + 1).trim();
  }
  return undefined;
}

/**
 * Server-side login sessions (ROADMAP P1-01): a random 256-bit token lives only in an HttpOnly
 * cookie; the database keeps its SHA-256. Sessions are bound to one tenant, expire after an idle
 * period and an absolute lifetime, and are revoked on logout / password change.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** `__Host-` prefix needs Secure, so it is used in production (HTTPS) only. */
  get cookieName(): string {
    return this.config.isProduction ? '__Host-educenter_session' : 'educenter_session';
  }

  static readonly include = USER_INCLUDE;

  /**
   * Builds the principal for an account, or undefined when the account (or its linked teacher /
   * student profile) may not sign in.
   */
  static toPrincipal(u: UserForPrincipal): Principal | undefined {
    if (u.status !== 'ACTIVE') return undefined;
    const base = { tenantId: u.tenant.id, tenantSlug: u.tenant.slug, tenantName: u.tenant.name, authMethod: 'session' as const, userId: u.id, email: u.email };
    if (u.role === 'ADMIN') return { ...base, role: 'ADMIN', personaKey: 'admin', displayName: u.displayName };
    if (u.role === 'TEACHER') {
      if (!u.teacher || u.teacher.status === 'INACTIVE') return undefined;
      return { ...base, role: 'TEACHER', personaKey: `teacher:${u.teacher.code}`, displayName: u.teacher.fullName, teacherId: u.teacher.id };
    }
    if (!u.student || u.student.status === 'ARCHIVED') return undefined;
    return { ...base, role: 'STUDENT', personaKey: `student:${u.student.code}`, displayName: u.student.fullName, studentId: u.student.id };
  }

  /** Creates a session for the user and sets the cookie. Revokes the session the request already carried (rotation). */
  async start(req: SessionRequest, res: Response, user: { id: string; tenantId: string }): Promise<void> {
    await this.revokeCurrent(req);
    const token = randomBytes(32).toString('base64url');
    const absoluteMs = this.config.get('SESSION_ABSOLUTE_HOURS') * 3_600_000;
    const session = await this.prisma.authSession.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + absoluteMs),
        ip: req.ip?.slice(0, 64) ?? null,
        userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    req.authSessionId = session.id;
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: absoluteMs,
    });
  }

  /** Resolves the principal of a valid session cookie, or undefined (no / unknown / expired / revoked session). */
  async resolve(req: SessionRequest): Promise<Principal | undefined> {
    const token = readCookie(req, this.cookieName);
    if (!token || !TOKEN_FORMAT.test(token)) return undefined;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, lastSeenAt: true, expiresAt: true, revokedAt: true, user: { include: USER_INCLUDE } },
    });
    if (!session || session.revokedAt) return undefined;
    const now = Date.now();
    const idleMs = this.config.get('SESSION_IDLE_MINUTES') * 60_000;
    if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + idleMs <= now) return undefined;
    const principal = SessionService.toPrincipal(session.user);
    if (!principal) return undefined;
    if (now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    req.authSessionId = session.id;
    return principal;
  }

  /** Revokes the session carried by the request (if any). Safe to call without a session. */
  async revokeCurrent(req: SessionRequest): Promise<void> {
    const token = readCookie(req, this.cookieName);
    if (!token || !TOKEN_FORMAT.test(token)) return;
    await this.prisma.authSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Revokes every session of a user except `keepSessionId` (password change). */
  async revokeOthers(tenantId: string, userId: string, keepSessionId?: string): Promise<number> {
    const res = await this.prisma.authSession.updateMany({
      where: { tenantId, userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, { httpOnly: true, secure: this.config.isProduction, sameSite: 'lax', path: '/' });
  }
}
