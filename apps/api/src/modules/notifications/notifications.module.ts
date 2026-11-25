import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { NotificationType, Prisma } from '../../generated/prisma/client';
import { ActivityService, type NotificationTarget } from '../../common/activity/activity.service';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import { badRequest, notFound } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto, pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';

const TYPES = ['SCHEDULE', 'CLASS', 'TUITION', 'MATERIAL', 'GRADE', 'SYSTEM'] as const;
const AUDIENCES = ['ALL_STUDENTS', 'ALL_TEACHERS', 'EVERYONE', 'CLASS', 'STUDENT', 'TEACHER'] as const;

class NotificationQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(TYPES) type?: NotificationType;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() unread?: boolean;
}

class CreateNotificationDto {
  @IsIn(TYPES) type: NotificationType;
  @IsString() @MinLength(2) @MaxLength(200) title: string;
  @IsString() @MinLength(2) @MaxLength(2000) body: string;
  @IsOptional() @IsString() @MaxLength(300) link?: string;
  @IsIn(AUDIENCES) audience: (typeof AUDIENCES)[number];
  @ValidateIf((o) => o.audience === 'CLASS') @IsUUID() classroomId?: string;
  @ValidateIf((o) => o.audience === 'STUDENT') @IsUUID() studentId?: string;
  @ValidateIf((o) => o.audience === 'TEACHER') @IsUUID() teacherId?: string;
}

/** Notifications addressed to the current persona. */
export function inboxWhere(p: Principal): Prisma.NotificationWhereInput {
  if (p.role === 'ADMIN') return { tenantId: p.tenantId, recipientRole: 'ADMIN' };
  if (p.role === 'TEACHER') return { tenantId: p.tenantId, recipientRole: 'TEACHER', recipientTeacherId: p.teacherId };
  return { tenantId: p.tenantId, recipientRole: 'STUDENT', recipientStudentId: p.studentId };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  async list(p: Principal, q: NotificationQueryDto) {
    const where: Prisma.NotificationWhereInput = { ...inboxWhere(p), ...(q.type ? { type: q.type } : {}), ...(q.unread ? { readAt: null } : {}) };
    const [rows, total, unread, byType] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...inboxWhere(p), readAt: null } }),
      this.prisma.notification.groupBy({ by: ['type'], where: { ...inboxWhere(p), readAt: null }, _count: true }),
    ]);
    return {
      ...toPage(rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })), total, q),
      unreadCount: unread,
      unreadByType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
    };
  }

  async unreadCount(p: Principal) {
    return { unreadCount: await this.prisma.notification.count({ where: { ...inboxWhere(p), readAt: null } }) };
  }

  async markRead(p: Principal, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { ...inboxWhere(p), id, readAt: null }, data: { readAt: new Date() } });
    if (res.count === 0 && !(await this.prisma.notification.findFirst({ where: { ...inboxWhere(p), id }, select: { id: true } }))) throw notFound('thông báo');
    return { read: true };
  }

  async markAllRead(p: Principal) {
    const res = await this.prisma.notification.updateMany({ where: { ...inboxWhere(p), readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  /** Admin broadcast to a group, a class, or one person. */
  async create(p: Principal, dto: CreateNotificationDto) {
    return this.tx.run(p, async (db) => {
      let targets: NotificationTarget[] = [];
      if (dto.audience === 'ALL_STUDENTS' || dto.audience === 'EVERYONE') {
        const students = await db.student.findMany({ where: { tenantId: p.tenantId, status: 'ACTIVE' }, select: { id: true } });
        targets.push(...students.map((s) => ({ role: 'STUDENT' as const, studentId: s.id })));
      }
      if (dto.audience === 'ALL_TEACHERS' || dto.audience === 'EVERYONE') {
        const teachers = await db.teacher.findMany({ where: { tenantId: p.tenantId, status: { not: 'INACTIVE' } }, select: { id: true } });
        targets.push(...teachers.map((t) => ({ role: 'TEACHER' as const, teacherId: t.id })));
      }
      if (dto.audience === 'EVERYONE') targets.push({ role: 'ADMIN' });
      if (dto.audience === 'CLASS') {
        if (!(await db.classroom.findFirst({ where: { tenantId: p.tenantId, id: dto.classroomId }, select: { id: true } }))) throw notFound('lớp học');
        targets = await this.activity.classAudience(db, p.tenantId, dto.classroomId!);
      }
      if (dto.audience === 'STUDENT') {
        if (!(await db.student.findFirst({ where: { tenantId: p.tenantId, id: dto.studentId }, select: { id: true } }))) throw notFound('học viên');
        targets = [{ role: 'STUDENT', studentId: dto.studentId }];
      }
      if (dto.audience === 'TEACHER') {
        if (!(await db.teacher.findFirst({ where: { tenantId: p.tenantId, id: dto.teacherId }, select: { id: true } }))) throw notFound('giáo viên');
        targets = [{ role: 'TEACHER', teacherId: dto.teacherId }];
      }
      if (targets.length === 0) throw badRequest('Không có người nhận phù hợp', 'audience');
      const sent = await this.activity.notify(db, p.tenantId, { type: dto.type, title: dto.title, body: dto.body, link: dto.link }, targets);
      await this.activity.record(db, p, { action: 'notification.sent', entityType: 'notification', summary: `Gửi thông báo "${dto.title}" tới ${sent} người nhận` });
      return { sent };
    });
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: NotificationQueryDto) {
    return this.notifications.list(p, q);
  }

  @Get('unread-count')
  @AnyRole()
  unread(@CurrentPrincipal() p: Principal) {
    return this.notifications.unreadCount(p);
  }

  @Post('read-all')
  @AnyRole()
  readAll(@CurrentPrincipal() p: Principal) {
    return this.notifications.markAllRead(p);
  }

  @Post(':id/read')
  @AnyRole()
  read(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(p, id);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateNotificationDto) {
    return this.notifications.create(p, dto);
  }
}

class ActivityQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(40) entityType?: string;
}

@Controller('activity')
export class ActivityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('ADMIN')
  async list(@CurrentPrincipal() p: Principal, @Query() q: ActivityQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.ActivityLogWhereInput = { tenantId: p.tenantId, ...(q.entityType ? { entityType: q.entityType } : {}), ...(search ? { summary: { contains: search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), this.prisma.activityLog.count({ where })]);
    return toPage(rows, total, q);
  }
}

@Module({ controllers: [NotificationsController, ActivityController], providers: [NotificationsService] })
export class NotificationsModule {}
