import { Injectable } from '@nestjs/common';
import { requestContext } from '../context/request-context';
import type { Principal } from '../context/principal';
import type { Db } from '../prisma/tenant-tx';
import type { NotificationType, RecipientRole } from '../../generated/prisma/client';

export interface ActivityInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
}

export interface NotificationTarget {
  role: RecipientRole;
  teacherId?: string | null;
  studentId?: string | null;
}

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

/** Append-only business activity ("Hoạt động gần đây") and in-app notification fan-out. */
@Injectable()
export class ActivityService {
  async record(db: Db, principal: Principal, input: ActivityInput): Promise<void> {
    await db.activityLog.create({
      data: {
        tenantId: principal.tenantId,
        actorRole: principal.role,
        actorName: principal.displayName,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary.slice(0, 500),
        requestId: requestContext.requestId() ?? null,
      },
    });
  }

  async notify(db: Db, tenantId: string, input: NotificationInput, targets: NotificationTarget[]): Promise<number> {
    const unique = new Map<string, NotificationTarget>();
    for (const t of targets) unique.set(`${t.role}:${t.teacherId ?? ''}:${t.studentId ?? ''}`, t);
    if (unique.size === 0) return 0;
    const res = await db.notification.createMany({
      data: [...unique.values()].map((t) => ({
        tenantId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        link: input.link ?? null,
        recipientRole: t.role,
        recipientTeacherId: t.teacherId ?? null,
        recipientStudentId: t.studentId ?? null,
      })),
    });
    return res.count;
  }

  /** Recipients of a class: its teacher and every actively enrolled student. */
  async classAudience(db: Db, tenantId: string, classroomId: string): Promise<NotificationTarget[]> {
    const cls = await db.classroom.findFirst({
      where: { tenantId, id: classroomId },
      select: { teacherId: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } },
    });
    if (!cls) return [];
    const targets: NotificationTarget[] = cls.enrollments.map((e) => ({ role: 'STUDENT', studentId: e.studentId }));
    if (cls.teacherId) targets.push({ role: 'TEACHER', teacherId: cls.teacherId });
    return targets;
  }
}
