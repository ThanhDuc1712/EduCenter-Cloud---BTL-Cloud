import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';
import type { Response } from 'express';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';

const WINDOW_MS = 15 * 60_000;
/** Failed logins per account (tenant + email) before a temporary lock. */
const MAX_ACCOUNT_FAILURES = 5;
/** Failed logins per IP — high on purpose: a whole center may share one NAT address (ROADMAP P1-06). */
const MAX_IP_FAILURES = 50;
const REGISTER_WINDOW_MS = 60 * 60_000;
const MAX_REGISTRATIONS_PER_IP = 10;
const RETENTION_MS = 24 * 3_600_000;

/**
 * PostgreSQL-backed limiter (D-06): shared by every API instance, survives restarts, no Redis.
 * Rows hold a key (`login:<tenant>:<email>` / `register`), the client IP and the outcome only.
 */
@Injectable()
export class LoginRateLimiter {
  constructor(private readonly prisma: PrismaService) {}

  static loginKey(tenantSlug: string, email: string): string {
    return `login:${tenantSlug}:${email}`.slice(0, 340);
  }

  /** Throws 429 (with Retry-After) when the account or the IP has too many recent failures. */
  async assertLoginAllowed(res: Response, key: string, ip: string | undefined): Promise<void> {
    const since = new Date(Date.now() - WINDOW_MS);
    const lastSuccess = await this.prisma.loginAttempt.findFirst({ where: { key, success: true, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const from = lastSuccess && lastSuccess.createdAt > since ? lastSuccess.createdAt : since;
    const [accountFailures, ipFailures] = await Promise.all([
      this.prisma.loginAttempt.findMany({ where: { key, success: false, createdAt: { gt: from } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true }, take: MAX_ACCOUNT_FAILURES }),
      ip ? this.prisma.loginAttempt.count({ where: { ip, success: false, key: { startsWith: 'login:' }, createdAt: { gte: since } } }) : Promise.resolve(0),
    ]);
    if (accountFailures.length >= MAX_ACCOUNT_FAILURES) this.reject(res, accountFailures[0].createdAt.getTime() + WINDOW_MS, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
    if (ipFailures >= MAX_IP_FAILURES) this.reject(res, Date.now() + WINDOW_MS, 'Có quá nhiều lần đăng nhập thất bại từ mạng này. Vui lòng thử lại sau.');
  }

  async assertRegisterAllowed(res: Response, ip: string | undefined): Promise<void> {
    if (!ip) return;
    const count = await this.prisma.loginAttempt.count({ where: { key: 'register', ip, success: true, createdAt: { gte: new Date(Date.now() - REGISTER_WINDOW_MS) } } });
    if (count >= MAX_REGISTRATIONS_PER_IP) this.reject(res, Date.now() + REGISTER_WINDOW_MS, 'Đã có quá nhiều tài khoản được đăng ký từ mạng này. Vui lòng thử lại sau.');
  }

  async record(key: string, ip: string | undefined, success: boolean): Promise<void> {
    await this.prisma.loginAttempt.create({ data: { key, ip: ip?.slice(0, 64) ?? null, success } });
    // Opportunistic retention: old rows are useless to the limiter.
    if (Math.random() < 0.02) {
      await this.prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } });
    }
  }

  private reject(res: Response, retryAtMs: number, message: string): never {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000))));
    throw new AppException(ErrorCode.TOO_MANY_REQUESTS, HttpStatus.TOO_MANY_REQUESTS, message);
  }
}
