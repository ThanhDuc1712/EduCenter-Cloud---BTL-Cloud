import { HttpStatus, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ActivityService } from '../../common/activity/activity.service';
import { dummyHash, hashPassword, verifyPassword } from '../../common/auth/password';
import { SessionService, type SessionRequest } from '../../common/auth/session.service';
import { badRequest, conflict } from '../../common/authz/scope';
import { AppConfigService } from '../../common/config/app-config.service';
import type { Principal } from '../../common/context/principal';
import { AppException } from '../../common/errors/app-exception';
import { AppLogger } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';
import { nextStudentCode } from '../students/students.service';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { LoginRateLimiter } from './login-rate-limiter';

const INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';

/**
 * Login / self-registration / logout / password change (ROADMAP P1-01, D-24).
 *  - Login needs tenantSlug + email + password; every failure cause returns the same 401.
 *  - Registration is public but only ever creates a STUDENT account with a NEW student profile:
 *    it never grants ADMIN/TEACHER and never attaches to an existing profile (no account takeover).
 *  - Passwords: Argon2id; raw passwords and tokens are never stored or logged.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly sessions: SessionService,
    private readonly limiter: LoginRateLimiter,
    private readonly activity: ActivityService,
    private readonly config: AppConfigService,
    private readonly logger: AppLogger,
  ) {}

  options() {
    return {
      defaultTenantSlug: this.config.get('DEMO_TENANT_SLUG'),
      registrationEnabled: this.config.get('REGISTRATION_ENABLED'),
      authMode: this.config.get('AUTH_MODE'),
    };
  }

  async login(req: SessionRequest, res: Response, dto: LoginDto): Promise<Principal> {
    const key = LoginRateLimiter.loginKey(dto.tenantSlug, dto.email);
    await this.limiter.assertLoginAllowed(res, key, req.ip);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, tenant: { slug: dto.tenantSlug } },
      include: SessionService.include,
    });
    // Always run Argon2 — an unknown email takes as long as a wrong password.
    const passwordOk = await verifyPassword(dto.password, user?.passwordHash ?? (await dummyHash()));
    const principal = user && passwordOk ? SessionService.toPrincipal(user) : undefined;
    if (!user || !principal) {
      await this.limiter.record(key, req.ip, false);
      this.logger.event('warn', 'auth.login.failed', { tenantSlug: dto.tenantSlug, knownAccount: Boolean(user) }, 'AuthService');
      throw new AppException(INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Email, mật khẩu hoặc mã trung tâm không đúng');
    }

    await this.limiter.record(key, req.ip, true);
    await this.sessions.start(req, res, { id: user.id, tenantId: user.tenantId });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    this.logger.event('log', 'auth.login.succeeded', { userId: user.id, tenantId: user.tenantId, role: user.role }, 'AuthService');
    return principal;
  }

  async register(req: SessionRequest, res: Response, dto: RegisterDto): Promise<Principal> {
    if (!this.config.get('REGISTRATION_ENABLED')) {
      throw new AppException('REGISTRATION_DISABLED', HttpStatus.FORBIDDEN, 'Trung tâm hiện không mở đăng ký tài khoản trực tuyến');
    }
    await this.limiter.assertRegisterAllowed(res, req.ip);
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug }, select: { id: true } });
    if (!tenant) throw badRequest('Không tìm thấy trung tâm với mã này', 'tenantSlug');

    const passwordHash = await hashPassword(dto.password); // CPU work outside the transaction
    const { user, principal } = await this.tx.run({ tenantId: tenant.id }, async (db) => {
      if (await db.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: dto.email } }, select: { id: true } })) {
        throw conflict('EMAIL_ALREADY_REGISTERED', 'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng email khác.');
      }
      const code = await nextStudentCode(db, tenant.id);
      const student = await db.student.create({
        data: { tenantId: tenant.id, code, fullName: dto.fullName, email: dto.email, phone: dto.phone ?? null, status: 'ACTIVE', note: 'Tự đăng ký tài khoản trực tuyến' },
      });
      const created = await db.user.create({
        data: { tenantId: tenant.id, email: dto.email, passwordHash, role: 'STUDENT', displayName: dto.fullName, studentId: student.id },
        include: SessionService.include,
      });
      const p = SessionService.toPrincipal(created);
      if (!p) throw new Error('freshly registered account cannot sign in');
      await this.activity.record(db, p, { action: 'student.registered', entityType: 'student', entityId: student.id, summary: `Học viên ${student.fullName} (${student.code}) tự đăng ký tài khoản` });
      await this.activity.notify(
        db,
        tenant.id,
        { type: 'SYSTEM', title: 'Học viên mới đăng ký', body: `${student.fullName} (${student.code}) vừa tự đăng ký tài khoản trực tuyến.`, link: `/students/${student.id}` },
        [{ role: 'ADMIN' }],
      );
      return { user: created, principal: p };
    });

    await this.limiter.record('register', req.ip, true);
    await this.sessions.start(req, res, { id: user.id, tenantId: user.tenantId });
    this.logger.event('log', 'auth.register.succeeded', { userId: user.id, tenantId: user.tenantId }, 'AuthService');
    return principal;
  }

  async logout(req: SessionRequest, res: Response): Promise<void> {
    await this.sessions.revokeCurrent(req);
    this.sessions.clearCookie(res);
  }

  /** Changes the password and revokes every other session of the account. */
  async changePassword(p: Principal, req: SessionRequest, res: Response, dto: ChangePasswordDto): Promise<void> {
    if (!p.userId) throw new AppException('NOT_A_LOGIN_ACCOUNT', HttpStatus.BAD_REQUEST, 'Chế độ demo không có mật khẩu để đổi');
    const user = await this.prisma.user.findFirst({ where: { tenantId: p.tenantId, id: p.userId }, select: { id: true, email: true, passwordHash: true } });
    if (!user) throw new AppException('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Bạn cần đăng nhập để tiếp tục');

    const key = LoginRateLimiter.loginKey(p.tenantSlug, user.email);
    await this.limiter.assertLoginAllowed(res, key, req.ip);
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      await this.limiter.record(key, req.ip, false);
      throw badRequest('Mật khẩu hiện tại không đúng', 'currentPassword');
    }
    if (dto.currentPassword === dto.newPassword) throw badRequest('Mật khẩu mới phải khác mật khẩu hiện tại', 'newPassword');

    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(dto.newPassword) } });
    const revoked = await this.sessions.revokeOthers(p.tenantId, user.id, req.authSessionId);
    this.logger.event('log', 'auth.password.changed', { userId: user.id, tenantId: p.tenantId, revokedSessions: revoked }, 'AuthService');
  }
}
