import { Injectable } from '@nestjs/common';
import type { AttendanceStatus, Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { assertCanManageClass, badRequest, classroomScope, notFound, sessionScope, studentScope, unprocessable } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';

export interface AttendanceCounts {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** (present + late) / total, in percent with one decimal. */
  rate: number;
}

export function countAttendance(statuses: AttendanceStatus[]): AttendanceCounts {
  const c = { total: statuses.length, present: 0, late: 0, absent: 0, excused: 0, rate: 0 };
  for (const s of statuses) {
    if (s === 'PRESENT') c.present += 1;
    else if (s === 'LATE') c.late += 1;
    else if (s === 'ABSENT') c.absent += 1;
    else c.excused += 1;
  }
  c.rate = c.total ? Math.round(((c.present + c.late) / c.total) * 1000) / 10 : 0;
  return c;
}

export interface AttendanceRecordInput {
  studentId: string;
  status: AttendanceStatus;
  note?: string;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  /** Roster of a session (students enrolled in the class) with their current attendance status. */
  async sheet(p: Principal, sessionId: string) {
    const session = await this.prisma.classSession.findFirst({
      where: { AND: [sessionScope(p), { id: sessionId }] },
      include: { classroom: { select: { id: true, code: true, name: true, teacherId: true } }, room: { select: { name: true } }, teacher: { select: { fullName: true } } },
    });
    if (!session) throw notFound('buổi học');
    const [enrollments, records] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { tenantId: p.tenantId, classroomId: session.classroomId, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) },
        orderBy: { student: { fullName: 'asc' } },
        include: { student: { select: { id: true, code: true, fullName: true } } },
      }),
      this.prisma.attendance.findMany({ where: { tenantId: p.tenantId, sessionId, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) } }),
    ]);
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const rows = enrollments
      .filter((e) => e.status === 'ACTIVE' || byStudent.has(e.studentId))
      .map((e) => ({ student: e.student, enrollmentStatus: e.status, status: byStudent.get(e.studentId)?.status ?? null, note: byStudent.get(e.studentId)?.note ?? null, recordedAt: byStudent.get(e.studentId)?.updatedAt ?? null }));
    return {
      session: { id: session.id, startsAt: session.startsAt, endsAt: session.endsAt, topic: session.topic, status: session.status, room: session.room?.name ?? null, teacher: session.teacher?.fullName ?? null, classroom: { id: session.classroom.id, code: session.classroom.code, name: session.classroom.name } },
      canEdit: p.role === 'ADMIN' || (p.role === 'TEACHER' && session.classroom.teacherId === p.teacherId),
      summary: countAttendance(records.map((r) => r.status)),
      rows,
    };
  }

  /** Records (or updates) attendance for a session — admin or the class teacher. */
  async record(p: Principal, sessionId: string, records: AttendanceRecordInput[], markCompleted: boolean) {
    const ids = records.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length) throw badRequest('Danh sách điểm danh có học viên trùng lặp', 'records');
    return this.tx.run(p, async (db) => {
      const session = await db.classSession.findFirst({ where: { tenantId: p.tenantId, id: sessionId }, include: { classroom: true } });
      if (!session) throw notFound('buổi học');
      assertCanManageClass(p, session.classroom);
      if (session.status === 'CANCELLED') throw unprocessable('SESSION_CANCELLED', 'Buổi học đã hủy, không thể điểm danh');
      if (session.startsAt.getTime() > Date.now() + 30 * 60_000) throw unprocessable('SESSION_NOT_STARTED', 'Chưa đến giờ học, không thể điểm danh trước');

      const enrolled = await db.enrollment.findMany({ where: { tenantId: p.tenantId, classroomId: session.classroomId, studentId: { in: ids } }, select: { studentId: true } });
      const enrolledIds = new Set(enrolled.map((e) => e.studentId));
      const outsider = ids.find((id) => !enrolledIds.has(id));
      if (outsider) throw unprocessable('STUDENT_NOT_IN_CLASS', 'Có học viên không thuộc lớp này trong danh sách điểm danh');

      for (const r of records) {
        await db.attendance.upsert({
          where: { tenantId_sessionId_studentId: { tenantId: p.tenantId, sessionId, studentId: r.studentId } },
          create: { tenantId: p.tenantId, sessionId, studentId: r.studentId, status: r.status, note: r.note ?? null },
          update: { status: r.status, note: r.note ?? null },
        });
      }
      if (markCompleted && session.status === 'SCHEDULED' && session.startsAt.getTime() <= Date.now()) {
        await db.classSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });
      }
      const counts = countAttendance(records.map((r) => r.status));
      await this.activity.record(db, p, { action: 'attendance.recorded', entityType: 'class_session', entityId: sessionId, summary: `Điểm danh lớp ${session.classroom.code}: ${counts.present} có mặt, ${counts.late} muộn, ${counts.absent} vắng, ${counts.excused} có phép` });
      const absentees = records.filter((r) => r.status === 'ABSENT').map((r) => ({ role: 'STUDENT' as const, studentId: r.studentId }));
      if (absentees.length) {
        await this.activity.notify(db, p.tenantId, { type: 'CLASS', title: `Vắng mặt buổi học lớp ${session.classroom.code}`, body: 'Bạn được ghi nhận vắng mặt. Liên hệ giáo viên nếu có sai sót.', link: '/attendance' }, absentees);
      }
      return { saved: records.length, summary: counts };
    });
  }

  /** Per-student rates in one class (teacher/admin) — or only the caller for a student. */
  async classSummary(p: Principal, classroomId: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id: classroomId }] }, select: { id: true, code: true, name: true } });
    if (!c) throw notFound('lớp học');
    const [enrollments, records, sessions] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { tenantId: p.tenantId, classroomId, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) }, include: { student: { select: { id: true, code: true, fullName: true } } }, orderBy: { student: { fullName: 'asc' } } }),
      this.prisma.attendance.findMany({ where: { tenantId: p.tenantId, session: { classroomId }, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) }, select: { studentId: true, status: true } }),
      this.prisma.classSession.findMany({ where: { tenantId: p.tenantId, classroomId, status: { not: 'CANCELLED' } }, select: { id: true, startsAt: true, status: true, _count: { select: { attendances: true } } }, orderBy: { startsAt: 'asc' } }),
    ]);
    const byStudent = new Map<string, AttendanceStatus[]>();
    for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r.status]);
    return {
      classroom: c,
      overall: countAttendance(records.map((r) => r.status)),
      sessionsHeld: sessions.filter((s) => s.startsAt.getTime() <= Date.now()).length,
      sessionsRecorded: sessions.filter((s) => s._count.attendances > 0).length,
      students: enrollments.map((e) => ({ student: e.student, enrollmentStatus: e.status, ...countAttendance(byStudent.get(e.studentId) ?? []) })),
    };
  }

  /** Per-class rates for one student. */
  async studentSummary(p: Principal, studentId: string) {
    const s = await this.prisma.student.findFirst({ where: { AND: [studentScope(p), { id: studentId }] }, select: { id: true } });
    if (!s) throw notFound('học viên');
    const where: Prisma.AttendanceWhereInput = { tenantId: p.tenantId, studentId, ...(p.role === 'TEACHER' ? { session: { classroom: { teacherId: p.teacherId } } } : {}) };
    const records = await this.prisma.attendance.findMany({ where, select: { status: true, session: { select: { classroomId: true, classroom: { select: { code: true, name: true } } } } } });
    const byClass = new Map<string, { classroom: { id: string; code: string; name: string }; statuses: AttendanceStatus[] }>();
    for (const r of records) {
      const entry = byClass.get(r.session.classroomId) ?? { classroom: { id: r.session.classroomId, ...r.session.classroom }, statuses: [] };
      entry.statuses.push(r.status);
      byClass.set(r.session.classroomId, entry);
    }
    return { overall: countAttendance(records.map((r) => r.status)), classes: [...byClass.values()].map((v) => ({ classroom: v.classroom, ...countAttendance(v.statuses) })) };
  }

  async history(p: Principal, q: { studentId?: string; classroomId?: string; status?: AttendanceStatus; page: number; pageSize: number }) {
    const where: Prisma.AttendanceWhereInput = {
      AND: [
        { tenantId: p.tenantId, session: sessionScope(p) },
        p.role === 'STUDENT' ? { studentId: p.studentId } : {},
        q.studentId ? { studentId: q.studentId } : {},
        q.classroomId ? { session: { classroomId: q.classroomId } } : {},
        q.status ? { status: q.status } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: { session: { startsAt: 'desc' } },
        ...pageArgs(q),
        include: { student: { select: { id: true, code: true, fullName: true } }, session: { select: { id: true, startsAt: true, endsAt: true, topic: true, classroom: { select: { id: true, code: true, name: true } } } } },
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return toPage(rows.map((r) => ({ id: r.id, status: r.status, note: r.note, recordedAt: r.updatedAt, student: r.student, session: r.session })), total, q);
  }

  /** Sessions needing attendance (past, scheduled/completed, no records yet) for the caller's classes. */
  async pending(p: Principal) {
    const rows = await this.prisma.classSession.findMany({
      where: { AND: [sessionScope(p), { status: { not: 'CANCELLED' } }, { startsAt: { lte: new Date(), gte: new Date(Date.now() - 30 * 86_400_000) } }, { attendances: { none: {} } }, { classroom: { enrollments: { some: { status: 'ACTIVE' } } } }] },
      orderBy: { startsAt: 'desc' },
      take: 30,
      include: { classroom: { select: { id: true, code: true, name: true } }, room: { select: { name: true } } },
    });
    return rows.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, topic: s.topic, classroom: s.classroom, room: s.room?.name ?? null }));
  }
}
