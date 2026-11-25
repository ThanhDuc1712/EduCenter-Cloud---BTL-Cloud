import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, sessionScope } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Db } from '../../common/prisma/tenant-tx';
import { addDaysYmd, isYmd, localDayRange, localYmd, minutesToHhmm, overlaps } from '../../common/time';
import { AppException } from '../../common/errors/app-exception';

export interface Candidate {
  startsAt: Date;
  endsAt: Date;
  teacherId: string | null;
  roomId: string | null;
}

export interface ScheduleConflict {
  kind: 'TEACHER' | 'ROOM';
  startsAt: Date;
  endsAt: Date;
  withSessionId: string | null;
  withClassroom: { id: string; code: string; name: string } | null;
  teacherName?: string | null;
  roomName?: string | null;
}

const MAX_RANGE_DAYS = 92;
const fmt = (d: Date) => {
  const local = new Date(d.getTime() + 7 * 3600_000);
  return `${minutesToHhmm(local.getUTCHours() * 60 + local.getUTCMinutes())} ${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}/${local.getUTCFullYear()}`;
};

export const sessionInclude = {
  classroom: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
  room: { select: { id: true, name: true } },
  _count: { select: { attendances: true } },
} satisfies Prisma.ClassSessionInclude;

export function mapSession(s: Prisma.ClassSessionGetPayload<{ include: typeof sessionInclude }>) {
  return {
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    topic: s.topic,
    status: s.status,
    note: s.note,
    classroom: s.classroom,
    teacher: s.teacher,
    room: s.room,
    attendanceRecorded: s._count.attendances,
  };
}

/**
 * Timetable conflicts (D-18): the teacher row (and room row) is locked with SELECT … FOR UPDATE and
 * overlaps are checked inside the same transaction, so two concurrent writes cannot double-book.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async findConflicts(db: Db, tenantId: string, candidates: Candidate[], opts: { excludeSessionIds?: string[]; excludeClassroomId?: string; lock?: boolean } = {}): Promise<ScheduleConflict[]> {
    if (candidates.length === 0) return [];
    const teacherIds = [...new Set(candidates.map((c) => c.teacherId).filter((x): x is string => !!x))];
    const roomIds = [...new Set(candidates.map((c) => c.roomId).filter((x): x is string => !!x))];
    if (opts.lock) {
      for (const id of teacherIds) await db.$queryRaw`SELECT id FROM teachers WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      for (const id of roomIds) await db.$queryRaw`SELECT id FROM rooms WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    if (teacherIds.length === 0 && roomIds.length === 0) return [];

    const minStart = new Date(Math.min(...candidates.map((c) => c.startsAt.getTime())));
    const maxEnd = new Date(Math.max(...candidates.map((c) => c.endsAt.getTime())));
    const existing = await db.classSession.findMany({
      where: {
        tenantId,
        status: { not: 'CANCELLED' },
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart },
        ...(opts.excludeSessionIds?.length ? { id: { notIn: opts.excludeSessionIds } } : {}),
        ...(opts.excludeClassroomId ? { classroomId: { not: opts.excludeClassroomId } } : {}),
        OR: [...(teacherIds.length ? [{ teacherId: { in: teacherIds } }] : []), ...(roomIds.length ? [{ roomId: { in: roomIds } }] : [])],
      },
      select: { id: true, startsAt: true, endsAt: true, teacherId: true, roomId: true, classroom: { select: { id: true, code: true, name: true } }, teacher: { select: { fullName: true } }, room: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });

    const out: ScheduleConflict[] = [];
    for (const c of candidates) {
      for (const e of existing) {
        if (!overlaps(c.startsAt, c.endsAt, e.startsAt, e.endsAt)) continue;
        if (c.teacherId && e.teacherId === c.teacherId) out.push({ kind: 'TEACHER', startsAt: c.startsAt, endsAt: c.endsAt, withSessionId: e.id, withClassroom: e.classroom, teacherName: e.teacher?.fullName });
        if (c.roomId && e.roomId === c.roomId) out.push({ kind: 'ROOM', startsAt: c.startsAt, endsAt: c.endsAt, withSessionId: e.id, withClassroom: e.classroom, roomName: e.room?.name });
      }
    }
    // Candidates overlapping each other (e.g. two slots of the new timetable).
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (!overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) continue;
        if (a.teacherId && a.teacherId === b.teacherId) out.push({ kind: 'TEACHER', startsAt: b.startsAt, endsAt: b.endsAt, withSessionId: null, withClassroom: null });
        else if (a.roomId && a.roomId === b.roomId) out.push({ kind: 'ROOM', startsAt: b.startsAt, endsAt: b.endsAt, withSessionId: null, withClassroom: null });
      }
    }
    return out;
  }

  /** Throws 409 SCHEDULE_CONFLICT listing the first conflicts (message is safe to show). */
  async assertNoConflicts(db: Db, tenantId: string, candidates: Candidate[], opts: { excludeSessionIds?: string[]; excludeClassroomId?: string } = {}): Promise<void> {
    const found = await this.findConflicts(db, tenantId, candidates, { ...opts, lock: true });
    if (found.length === 0) return;
    const details = found.slice(0, 5).map((c) => ({
      field: c.kind === 'TEACHER' ? 'teacherId' : 'roomId',
      message: `${c.kind === 'TEACHER' ? 'Trùng lịch giáo viên' : 'Trùng phòng học'} lúc ${fmt(c.startsAt)}${c.withClassroom ? ` với lớp ${c.withClassroom.code}` : ' (trong lịch mới)'}`,
    }));
    throw new AppException('SCHEDULE_CONFLICT', 409, `Phát hiện ${found.length} xung đột lịch. ${details[0].message}`, details);
  }

  parseRange(from?: string, to?: string): { fromYmd: string; toYmd: string } {
    const fromYmd = from ?? localYmd();
    const toYmd = to ?? addDaysYmd(fromYmd, 6);
    if (!isYmd(fromYmd) || !isYmd(toYmd)) throw badRequest('from/to phải có dạng YYYY-MM-DD');
    if (toYmd < fromYmd) throw badRequest('to phải sau from');
    if (addDaysYmd(fromYmd, MAX_RANGE_DAYS) < toYmd) throw badRequest(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`);
    return { fromYmd, toYmd };
  }

  /** Calendar view (day / week / month) with optional class / teacher / room filter, scoped by role. */
  async calendar(p: Principal, q: { from?: string; to?: string; classroomId?: string; teacherId?: string; roomId?: string; includeCancelled?: boolean }) {
    const { fromYmd, toYmd } = this.parseRange(q.from, q.to);
    const range = localDayRange(fromYmd, toYmd);
    const sessions = await this.prisma.classSession.findMany({
      where: {
        AND: [
          sessionScope(p),
          { startsAt: { gte: range.start, lt: range.end } },
          q.classroomId ? { classroomId: q.classroomId } : {},
          q.teacherId ? { teacherId: q.teacherId } : {},
          q.roomId ? { roomId: q.roomId } : {},
          q.includeCancelled ? {} : { status: { not: 'CANCELLED' } },
        ],
      },
      orderBy: { startsAt: 'asc' },
      take: 1500,
      include: sessionInclude,
    });
    return { from: fromYmd, to: toYmd, items: sessions.map(mapSession) };
  }

  /** Scans existing sessions for teacher / room double-booking in a range (admin tool). */
  async scanConflicts(p: Principal, from?: string, to?: string) {
    const { fromYmd, toYmd } = this.parseRange(from, to ?? addDaysYmd(from ?? localYmd(), 30));
    const range = localDayRange(fromYmd, toYmd);
    const sessions = await this.prisma.classSession.findMany({
      where: { tenantId: p.tenantId, status: { not: 'CANCELLED' }, startsAt: { gte: range.start, lt: range.end } },
      orderBy: { startsAt: 'asc' },
      include: sessionInclude,
    });
    const pairs: { kind: 'TEACHER' | 'ROOM'; a: ReturnType<typeof mapSession>; b: ReturnType<typeof mapSession> }[] = [];
    for (const key of ['teacherId', 'roomId'] as const) {
      const groups = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const id = s[key];
        if (!id) continue;
        groups.set(id, [...(groups.get(id) ?? []), s]);
      }
      for (const list of groups.values()) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length && list[j].startsAt < list[i].endsAt; j++) {
            if (overlaps(list[i].startsAt, list[i].endsAt, list[j].startsAt, list[j].endsAt)) {
              pairs.push({ kind: key === 'teacherId' ? 'TEACHER' : 'ROOM', a: mapSession(list[i]), b: mapSession(list[j]) });
            }
          }
        }
      }
    }
    return { from: fromYmd, to: toYmd, scannedSessions: sessions.length, conflicts: pairs };
  }

  async dryRun(p: Principal, candidates: Candidate[], excludeSessionIds?: string[], excludeClassroomId?: string) {
    const conflicts = await this.findConflicts(this.prisma, p.tenantId, candidates, { excludeSessionIds, excludeClassroomId });
    return { checked: candidates.length, conflicts };
  }
}
