import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { assertCanManageClass, badRequest, classroomScope, conflict, notFound, sessionScope, unprocessable } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx, type Tx } from '../../common/prisma/tenant-tx';
import { dateToYmd, expandWeeklySlots, hhmmToMinutes, localToUtc, localYmd, minutesToHhmm, ymdToDate, type SlotPattern } from '../../common/time';
import { ScheduleService, mapSession, sessionInclude, type Candidate } from '../schedule/schedule.service';
import type { ClassroomQueryDto, ConflictCheckDto, CreateClassroomDto, CreateSessionDto, ReplaceSlotsDto, SlotDto, UpdateClassroomDto, UpdateSessionDto } from './classrooms.dto';

const MINUTE = 60_000;

const classroomInclude = {
  course: { select: { id: true, code: true, name: true, tuitionVnd: true } },
  teacher: { select: { id: true, code: true, fullName: true } },
  room: { select: { id: true, name: true, capacity: true } },
  slots: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }], include: { room: { select: { id: true, name: true } } } },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } }, sessions: { where: { status: { not: 'CANCELLED' } } } } },
} satisfies Prisma.ClassroomInclude;

type ClassroomFull = Prisma.ClassroomGetPayload<{ include: typeof classroomInclude }>;

function mapClassroom(c: ClassroomFull) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    status: c.status,
    capacity: c.capacity,
    activeStudents: c._count.enrollments,
    seatsLeft: Math.max(0, c.capacity - c._count.enrollments),
    sessionCount: c._count.sessions,
    startDate: dateToYmd(c.startDate),
    endDate: dateToYmd(c.endDate),
    tuitionVnd: c.tuitionVnd ?? c.course.tuitionVnd,
    tuitionOverridden: c.tuitionVnd !== null,
    note: c.note,
    course: { id: c.course.id, code: c.course.code, name: c.course.name },
    teacher: c.teacher,
    room: c.room,
    slots: c.slots.map((s) => ({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: minutesToHhmm(s.startMinute), durationMinutes: s.durationMinutes, room: s.room })),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function toPatterns(slots: SlotDto[], defaultRoomId: string | null): SlotPattern[] {
  return slots.map((s) => ({ dayOfWeek: s.dayOfWeek, startMinute: hhmmToMinutes(s.startTime), durationMinutes: s.durationMinutes, roomId: s.roomId ?? defaultRoomId }));
}

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
    private readonly schedule: ScheduleService,
  ) {}

  async list(p: Principal, q: ClassroomQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.ClassroomWhereInput = {
      AND: [
        classroomScope(p),
        q.status ? { status: q.status } : {},
        q.courseId ? { courseId: q.courseId } : {},
        q.teacherId ? { teacherId: q.teacherId } : {},
        search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.classroom.findMany({ where, orderBy: [{ status: 'asc' }, { startDate: 'desc' }], ...pageArgs(q), include: classroomInclude }),
      this.prisma.classroom.count({ where }),
    ]);
    return toPage(rows.map(mapClassroom), total, q);
  }

  async get(p: Principal, id: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id }] }, include: classroomInclude });
    if (!c) throw notFound('lớp học');
    return mapClassroom(c);
  }

  private async validateRefs(db: Tx, tenantId: string, refs: { courseId?: string; teacherId?: string | null; roomId?: string | null; slotRoomIds?: string[]; capacity?: number }) {
    if (refs.courseId) {
      const course = await db.course.findFirst({ where: { tenantId, id: refs.courseId } });
      if (!course) throw notFound('khóa học');
      if (course.status === 'ARCHIVED') throw unprocessable('COURSE_ARCHIVED', 'Khóa học đã lưu trữ, không thể mở lớp mới');
    }
    if (refs.teacherId) {
      const teacher = await db.teacher.findFirst({ where: { tenantId, id: refs.teacherId } });
      if (!teacher) throw notFound('giáo viên');
      if (teacher.status !== 'ACTIVE') throw unprocessable('TEACHER_NOT_ACTIVE', `Giáo viên ${teacher.fullName} đang không ở trạng thái giảng dạy`);
    }
    const roomIds = [...new Set([...(refs.roomId ? [refs.roomId] : []), ...(refs.slotRoomIds ?? [])])];
    if (roomIds.length) {
      const rooms = await db.room.findMany({ where: { tenantId, id: { in: roomIds } } });
      if (rooms.length !== roomIds.length) throw notFound('phòng học');
      const small = refs.capacity ? rooms.find((r) => r.capacity < refs.capacity!) : undefined;
      if (small) throw unprocessable('ROOM_TOO_SMALL', `Phòng ${small.name} chỉ chứa ${small.capacity} người, nhỏ hơn sức chứa lớp (${refs.capacity})`);
    }
  }

  private assertSlotsValid(slots: SlotDto[]) {
    const patterns = slots.map((s) => ({ day: s.dayOfWeek, start: hhmmToMinutes(s.startTime), end: hhmmToMinutes(s.startTime) + s.durationMinutes }));
    for (const s of patterns) if (s.end > 24 * 60) throw badRequest('Buổi học phải kết thúc trong ngày', 'slots');
    for (let i = 0; i < patterns.length; i++)
      for (let j = i + 1; j < patterns.length; j++)
        if (patterns[i].day === patterns[j].day && patterns[i].start < patterns[j].end && patterns[j].start < patterns[i].end) throw badRequest('Các khung giờ trong thời khóa biểu bị chồng nhau', 'slots');
  }

  /** Generates sessions (from max(start, today) to end) and checks teacher/room conflicts under lock. */
  private async generateSessions(db: Tx, tenantId: string, classroom: { id: string; teacherId: string | null; roomId: string | null; startDate: Date; endDate: Date }, slots: SlotPattern[], onlyFuture: boolean): Promise<number> {
    const from = onlyFuture ? [dateToYmd(classroom.startDate), localYmd()].sort().at(-1)! : dateToYmd(classroom.startDate);
    const now = Date.now();
    const occurrences = expandWeeklySlots(from, dateToYmd(classroom.endDate), slots).filter((o) => !onlyFuture || o.startsAt.getTime() > now);
    if (occurrences.length === 0) return 0;
    const candidates: Candidate[] = occurrences.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt, teacherId: classroom.teacherId, roomId: o.roomId }));
    await this.schedule.assertNoConflicts(db, tenantId, candidates, { excludeClassroomId: classroom.id });
    const existingCount = await db.classSession.count({ where: { tenantId, classroomId: classroom.id } });
    await db.classSession.createMany({
      data: occurrences.map((o, i) => ({ tenantId, classroomId: classroom.id, teacherId: classroom.teacherId, roomId: o.roomId, startsAt: o.startsAt, endsAt: o.endsAt, topic: `Buổi ${existingCount + i + 1}` })),
    });
    return occurrences.length;
  }

  async create(p: Principal, dto: CreateClassroomDto) {
    if (dto.endDate < dto.startDate) throw badRequest('Ngày kết thúc phải sau ngày bắt đầu', 'endDate');
    const slots = dto.slots ?? [];
    this.assertSlotsValid(slots);
    return this.tx.run(p, async (db) => {
      if (await db.classroom.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } })) throw conflict('CLASSROOM_CODE_EXISTS', `Mã lớp ${dto.code} đã tồn tại`);
      await this.validateRefs(db, p.tenantId, { courseId: dto.courseId, teacherId: dto.teacherId, roomId: dto.roomId, slotRoomIds: slots.map((s) => s.roomId).filter((x): x is string => !!x), capacity: dto.capacity });
      const c = await db.classroom.create({
        data: {
          tenantId: p.tenantId,
          code: dto.code,
          name: dto.name,
          courseId: dto.courseId,
          teacherId: dto.teacherId ?? null,
          roomId: dto.roomId ?? null,
          capacity: dto.capacity,
          startDate: ymdToDate(dto.startDate),
          endDate: ymdToDate(dto.endDate),
          status: dto.status ?? (dto.startDate > localYmd() ? 'PLANNED' : 'ACTIVE'),
          tuitionVnd: dto.tuitionVnd === undefined ? null : BigInt(dto.tuitionVnd),
          note: dto.note,
        },
      });
      const patterns = toPatterns(slots, c.roomId);
      if (patterns.length) {
        await db.classScheduleSlot.createMany({ data: patterns.map((s) => ({ tenantId: p.tenantId, classroomId: c.id, dayOfWeek: s.dayOfWeek, startMinute: s.startMinute, durationMinutes: s.durationMinutes, roomId: s.roomId ?? null })) });
      }
      const generated = patterns.length && dto.generateSessions !== false ? await this.generateSessions(db, p.tenantId, c, patterns, false) : 0;
      await this.activity.record(db, p, { action: 'classroom.created', entityType: 'classroom', entityId: c.id, summary: `Mở lớp ${c.name} (${c.code}), ${generated} buổi học` });
      const full = await db.classroom.findUniqueOrThrow({ where: { id: c.id }, include: classroomInclude });
      return { ...mapClassroom(full), generatedSessions: generated };
    });
  }

  async update(p: Principal, id: string, dto: UpdateClassroomDto) {
    return this.tx.run(p, async (db) => {
      const existing = await db.classroom.findFirst({ where: { tenantId: p.tenantId, id }, include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } });
      if (!existing) throw notFound('lớp học');
      if (dto.code && dto.code !== existing.code && (await db.classroom.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } }))) throw conflict('CLASSROOM_CODE_EXISTS', `Mã lớp ${dto.code} đã tồn tại`);
      const capacity = dto.capacity ?? existing.capacity;
      if (capacity < existing._count.enrollments) throw unprocessable('CAPACITY_BELOW_ENROLLMENT', `Lớp đang có ${existing._count.enrollments} học viên, không thể giảm sức chứa xuống ${capacity}`);
      const start = dto.startDate ?? dateToYmd(existing.startDate);
      const end = dto.endDate ?? dateToYmd(existing.endDate);
      if (end < start) throw badRequest('Ngày kết thúc phải sau ngày bắt đầu', 'endDate');
      await this.validateRefs(db, p.tenantId, { teacherId: dto.teacherId, roomId: dto.roomId ?? (dto.capacity ? existing.roomId : undefined), capacity });

      const now = new Date();
      // Teacher reassignment applies to future sessions (D-18: teacher_id is copied to sessions).
      if (dto.teacherId && dto.teacherId !== existing.teacherId) {
        const future = await db.classSession.findMany({ where: { tenantId: p.tenantId, classroomId: id, status: 'SCHEDULED', startsAt: { gt: now } }, select: { id: true, startsAt: true, endsAt: true, roomId: true } });
        await this.schedule.assertNoConflicts(db, p.tenantId, future.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, teacherId: dto.teacherId!, roomId: null })), { excludeSessionIds: future.map((s) => s.id) });
        await db.classSession.updateMany({ where: { id: { in: future.map((s) => s.id) } }, data: { teacherId: dto.teacherId } });
      }
      if (dto.status === 'CANCELLED' && existing.status !== 'CANCELLED') {
        await db.classSession.updateMany({ where: { tenantId: p.tenantId, classroomId: id, status: 'SCHEDULED', startsAt: { gt: now } }, data: { status: 'CANCELLED' } });
      }
      await db.classroom.update({
        where: { id },
        data: {
          code: dto.code,
          name: dto.name,
          teacherId: dto.teacherId,
          roomId: dto.roomId,
          capacity: dto.capacity,
          startDate: dto.startDate ? ymdToDate(dto.startDate) : undefined,
          endDate: dto.endDate ? ymdToDate(dto.endDate) : undefined,
          status: dto.status,
          tuitionVnd: dto.tuitionVnd === undefined ? undefined : BigInt(dto.tuitionVnd),
          note: dto.note,
        },
      });
      const audience = await this.activity.classAudience(db, p.tenantId, id);
      if (dto.teacherId && dto.teacherId !== existing.teacherId) {
        audience.push({ role: 'TEACHER', teacherId: dto.teacherId });
        await this.activity.notify(db, p.tenantId, { type: 'CLASS', title: `Đổi giáo viên lớp ${existing.code}`, body: `Lớp ${existing.name} được phân công giáo viên mới từ các buổi sắp tới.`, link: `/classes/${id}` }, audience);
      } else if (dto.status === 'CANCELLED') {
        await this.activity.notify(db, p.tenantId, { type: 'CLASS', title: `Lớp ${existing.code} đã hủy`, body: `Lớp ${existing.name} đã bị hủy. Các buổi học sắp tới không còn hiệu lực.`, link: `/classes/${id}` }, audience);
      }
      await this.activity.record(db, p, { action: 'classroom.updated', entityType: 'classroom', entityId: id, summary: `Cập nhật lớp ${existing.code}${dto.status && dto.status !== existing.status ? ` → ${dto.status}` : ''}` });
      return mapClassroom(await db.classroom.findUniqueOrThrow({ where: { id }, include: classroomInclude }));
    });
  }

  async replaceSlots(p: Principal, id: string, dto: ReplaceSlotsDto) {
    this.assertSlotsValid(dto.slots);
    return this.tx.run(p, async (db) => {
      const c = await db.classroom.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!c) throw notFound('lớp học');
      if (c.status === 'COMPLETED' || c.status === 'CANCELLED') throw unprocessable('CLASSROOM_CLOSED', 'Lớp đã kết thúc hoặc đã hủy');
      await this.validateRefs(db, p.tenantId, { slotRoomIds: dto.slots.map((s) => s.roomId).filter((x): x is string => !!x), capacity: c.capacity });
      await db.classScheduleSlot.deleteMany({ where: { tenantId: p.tenantId, classroomId: id } });
      const patterns = toPatterns(dto.slots, c.roomId);
      if (patterns.length) await db.classScheduleSlot.createMany({ data: patterns.map((s) => ({ tenantId: p.tenantId, classroomId: id, dayOfWeek: s.dayOfWeek, startMinute: s.startMinute, durationMinutes: s.durationMinutes, roomId: s.roomId ?? null })) });
      let removed = 0;
      let generated = 0;
      if (dto.regenerate) {
        const del = await db.classSession.deleteMany({ where: { tenantId: p.tenantId, classroomId: id, status: 'SCHEDULED', startsAt: { gt: new Date() }, attendances: { none: {} } } });
        removed = del.count;
        generated = await this.generateSessions(db, p.tenantId, c, patterns, true);
        await this.activity.notify(db, p.tenantId, { type: 'SCHEDULE', title: `Thời khóa biểu mới lớp ${c.code}`, body: `Lịch học lớp ${c.name} đã được cập nhật (${generated} buổi sắp tới).`, link: '/schedule' }, await this.activity.classAudience(db, p.tenantId, id));
      }
      await this.activity.record(db, p, { action: 'classroom.slots.replaced', entityType: 'classroom', entityId: id, summary: `Cập nhật thời khóa biểu lớp ${c.code}: ${patterns.length} khung giờ, -${removed}/+${generated} buổi` });
      return { ...mapClassroom(await db.classroom.findUniqueOrThrow({ where: { id }, include: classroomInclude })), removedSessions: removed, generatedSessions: generated };
    });
  }

  async roster(p: Principal, id: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id }] }, select: { id: true } });
    if (!c) throw notFound('lớp học');
    const rows = await this.prisma.enrollment.findMany({
      where: { tenantId: p.tenantId, classroomId: id, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) },
      orderBy: [{ status: 'asc' }, { student: { fullName: 'asc' } }],
      include: { student: { select: { id: true, code: true, fullName: true, phone: true, email: true, status: true } } },
    });
    return rows.map((e) => ({ enrollmentId: e.id, status: e.status, enrolledAt: e.enrolledAt, student: e.student }));
  }

  // ───── Sessions ─────

  async sessions(p: Principal, classroomId: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id: classroomId }] }, select: { id: true } });
    if (!c) throw notFound('lớp học');
    const rows = await this.prisma.classSession.findMany({ where: { tenantId: p.tenantId, classroomId }, orderBy: { startsAt: 'asc' }, include: sessionInclude });
    return rows.map(mapSession);
  }

  async getSession(p: Principal, id: string) {
    const s = await this.prisma.classSession.findFirst({ where: { AND: [sessionScope(p), { id }] }, include: sessionInclude });
    if (!s) throw notFound('buổi học');
    return mapSession(s);
  }

  async createSession(p: Principal, classroomId: string, dto: CreateSessionDto) {
    return this.tx.run(p, async (db) => {
      const c = await db.classroom.findFirst({ where: { tenantId: p.tenantId, id: classroomId } });
      if (!c) throw notFound('lớp học');
      assertCanManageClass(p, c);
      if (c.status === 'CANCELLED') throw unprocessable('CLASSROOM_CLOSED', 'Lớp đã hủy');
      const roomId = dto.roomId ?? c.roomId;
      await this.validateRefs(db, p.tenantId, { roomId, capacity: c.capacity });
      const startsAt = localToUtc(dto.date, hhmmToMinutes(dto.startTime));
      const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * MINUTE);
      if (endsAt.getTime() > localToUtc(dto.date, 24 * 60).getTime()) throw badRequest('Buổi học phải kết thúc trong ngày', 'durationMinutes');
      await this.schedule.assertNoConflicts(db, p.tenantId, [{ startsAt, endsAt, teacherId: c.teacherId, roomId }]);
      const s = await db.classSession.create({ data: { tenantId: p.tenantId, classroomId, teacherId: c.teacherId, roomId, startsAt, endsAt, topic: dto.topic, note: dto.note }, include: sessionInclude });
      await this.activity.notify(db, p.tenantId, { type: 'SCHEDULE', title: `Buổi học mới lớp ${c.code}`, body: `Lớp ${c.name} có buổi học bổ sung ngày ${dto.date} lúc ${dto.startTime}.`, link: '/schedule' }, await this.activity.classAudience(db, p.tenantId, classroomId));
      await this.activity.record(db, p, { action: 'session.created', entityType: 'class_session', entityId: s.id, summary: `Thêm buổi học lớp ${c.code} ngày ${dto.date} ${dto.startTime}` });
      return mapSession(s);
    });
  }

  async updateSession(p: Principal, id: string, dto: UpdateSessionDto) {
    return this.tx.run(p, async (db) => {
      const s = await db.classSession.findFirst({ where: { tenantId: p.tenantId, id }, include: { classroom: true } });
      if (!s) throw notFound('buổi học');
      assertCanManageClass(p, s.classroom);

      const local = new Date(s.startsAt.getTime() + 7 * 3600_000);
      const date = dto.date ?? local.toISOString().slice(0, 10);
      const startMinute = dto.startTime ? hhmmToMinutes(dto.startTime) : local.getUTCHours() * 60 + local.getUTCMinutes();
      const duration = dto.durationMinutes ?? Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / MINUTE);
      const startsAt = localToUtc(date, startMinute);
      const endsAt = new Date(startsAt.getTime() + duration * MINUTE);
      const roomId = dto.roomId ?? s.roomId;
      const timeChanged = startsAt.getTime() !== s.startsAt.getTime() || endsAt.getTime() !== s.endsAt.getTime() || roomId !== s.roomId;
      if (dto.roomId) await this.validateRefs(db, p.tenantId, { roomId, capacity: s.classroom.capacity });
      const willBeActive = (dto.status ?? s.status) !== 'CANCELLED';
      if (timeChanged && willBeActive) await this.schedule.assertNoConflicts(db, p.tenantId, [{ startsAt, endsAt, teacherId: s.teacherId, roomId }], { excludeSessionIds: [id] });

      const updated = await db.classSession.update({ where: { id }, data: { startsAt, endsAt, roomId, topic: dto.topic, note: dto.note, status: dto.status }, include: sessionInclude });
      if (timeChanged || (dto.status === 'CANCELLED' && s.status !== 'CANCELLED')) {
        const cancelled = dto.status === 'CANCELLED';
        await this.activity.notify(
          db,
          p.tenantId,
          {
            type: 'SCHEDULE',
            title: cancelled ? `Hủy buổi học lớp ${s.classroom.code}` : `Đổi lịch buổi học lớp ${s.classroom.code}`,
            body: cancelled ? `Buổi học ngày ${local.toISOString().slice(0, 10)} của lớp ${s.classroom.name} đã bị hủy.` : `Buổi học được dời sang ${date} lúc ${minutesToHhmm(startMinute)}.`,
            link: '/schedule',
          },
          await this.activity.classAudience(db, p.tenantId, s.classroomId),
        );
      }
      await this.activity.record(db, p, { action: 'session.updated', entityType: 'class_session', entityId: id, summary: `Cập nhật buổi học lớp ${s.classroom.code}${dto.status ? ` (${dto.status})` : ''}` });
      return mapSession(updated);
    });
  }

  async checkConflicts(p: Principal, dto: ConflictCheckDto) {
    if (dto.endDate < dto.startDate) throw badRequest('Ngày kết thúc phải sau ngày bắt đầu', 'endDate');
    this.assertSlotsValid(dto.slots);
    let teacherId = dto.teacherId ?? null;
    let roomId = dto.roomId ?? null;
    if (dto.classroomId) {
      const c = await this.prisma.classroom.findFirst({ where: { tenantId: p.tenantId, id: dto.classroomId } });
      if (!c) throw notFound('lớp học');
      teacherId = teacherId ?? c.teacherId;
      roomId = roomId ?? c.roomId;
    }
    const occurrences = expandWeeklySlots(dto.startDate, dto.endDate, toPatterns(dto.slots, roomId));
    return this.schedule.dryRun(p, occurrences.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt, teacherId, roomId: o.roomId })), undefined, dto.classroomId);
  }
}
