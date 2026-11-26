import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { conflict, notFound, teacherScope } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx, lockSequence } from '../../common/prisma/tenant-tx';
import { addDaysYmd, dateToYmd, localDayRange, localYmd, ymdToDate } from '../../common/time';
import type { CreateTeacherDto, TeacherQueryDto, UpdateTeacherDto } from './teachers.dto';

type TeacherRow = Prisma.TeacherGetPayload<object>;

export function mapTeacher(t: TeacherRow, full = true) {
  return {
    id: t.id,
    code: t.code,
    fullName: t.fullName,
    email: t.email,
    phone: full ? t.phone : null,
    specialization: t.specialization,
    qualification: t.qualification,
    bio: t.bio,
    hiredAt: full && t.hiredAt ? dateToYmd(t.hiredAt) : null,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  async list(p: Principal, q: TeacherQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.TeacherWhereInput = {
      AND: [
        teacherScope(p),
        q.status ? { status: q.status } : {},
        search ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }, { specialization: { contains: search, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        orderBy: { code: 'asc' },
        ...pageArgs(q),
        include: { _count: { select: { classrooms: { where: { status: { in: ['ACTIVE', 'PLANNED'] } } } } } },
      }),
      this.prisma.teacher.count({ where }),
    ]);
    return toPage(rows.map((t) => ({ ...mapTeacher(t, p.role === 'ADMIN'), activeClasses: t._count.classrooms })), total, q);
  }

  async get(p: Principal, id: string) {
    const t = await this.prisma.teacher.findFirst({ where: { AND: [teacherScope(p), { id }] } });
    if (!t) throw notFound('giáo viên');
    return mapTeacher(t, p.role !== 'STUDENT');
  }

  async create(p: Principal, dto: CreateTeacherDto) {
    return this.tx.run(p, async (db) => {
      let code = dto.code;
      if (!code) {
        await lockSequence(db, p.tenantId, 'teacher-code');
        const last = await db.teacher.findFirst({ where: { tenantId: p.tenantId, code: { startsWith: 'GV' } }, orderBy: { code: 'desc' }, select: { code: true } });
        code = `GV${String((last ? Number(last.code.replace(/\D/g, '')) || 0 : 0) + 1).padStart(3, '0')}`;
      }
      if (await db.teacher.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code } } })) throw conflict('TEACHER_CODE_EXISTS', `Mã giáo viên ${code} đã tồn tại`);
      const t = await db.teacher.create({ data: { tenantId: p.tenantId, ...dto, code, hiredAt: dto.hiredAt ? ymdToDate(dto.hiredAt) : null } });
      await this.activity.record(db, p, { action: 'teacher.created', entityType: 'teacher', entityId: t.id, summary: `Thêm giáo viên ${t.fullName} (${t.code})` });
      return mapTeacher(t);
    });
  }

  async update(p: Principal, id: string, dto: UpdateTeacherDto) {
    return this.tx.run(p, async (db) => {
      const existing = await db.teacher.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!existing) throw notFound('giáo viên');
      if (dto.code && dto.code !== existing.code && (await db.teacher.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } }))) {
        throw conflict('TEACHER_CODE_EXISTS', `Mã giáo viên ${dto.code} đã tồn tại`);
      }
      const t = await db.teacher.update({ where: { id }, data: { ...dto, hiredAt: dto.hiredAt === undefined ? undefined : ymdToDate(dto.hiredAt) } });
      await this.activity.record(db, p, { action: 'teacher.updated', entityType: 'teacher', entityId: t.id, summary: `Cập nhật giáo viên ${t.fullName}${dto.status && dto.status !== existing.status ? ` → ${dto.status}` : ''}` });
      return mapTeacher(t);
    });
  }

  /** Teacher detail: assigned classes, teaching schedule, students taught, teaching statistics. */
  async overview(p: Principal, id: string) {
    const teacher = await this.get(p, id);
    const today = localYmd();
    const range = localDayRange(today, addDaysYmd(today, 13));
    const monthStart = `${today.slice(0, 8)}01`;
    const monthRange = localDayRange(monthStart, today);
    const classScope: Prisma.ClassroomWhereInput = { tenantId: p.tenantId, teacherId: id, ...(p.role === 'STUDENT' ? { enrollments: { some: { studentId: p.studentId } } } : {}) };

    const [classes, upcoming, taughtThisMonth, students] = await Promise.all([
      this.prisma.classroom.findMany({
        where: classScope,
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        include: { course: { select: { id: true, name: true } }, room: { select: { name: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      }),
      this.prisma.classSession.findMany({
        where: { tenantId: p.tenantId, teacherId: id, status: { not: 'CANCELLED' }, startsAt: { gte: range.start, lt: range.end }, classroom: classScope },
        orderBy: { startsAt: 'asc' },
        take: 40,
        include: { classroom: { select: { id: true, code: true, name: true } }, room: { select: { name: true } } },
      }),
      this.prisma.classSession.findMany({
        where: { tenantId: p.tenantId, teacherId: id, status: 'COMPLETED', startsAt: { gte: monthRange.start, lt: monthRange.end } },
        select: { startsAt: true, endsAt: true },
      }),
      p.role === 'STUDENT'
        ? Promise.resolve([])
        : this.prisma.enrollment.findMany({
            where: { tenantId: p.tenantId, status: 'ACTIVE', classroom: { teacherId: id } },
            orderBy: { student: { fullName: 'asc' } },
            take: 200,
            include: { student: { select: { id: true, code: true, fullName: true, phone: true } }, classroom: { select: { id: true, code: true } } },
          }),
    ]);

    const minutes = taughtThisMonth.reduce((s, x) => s + (x.endsAt.getTime() - x.startsAt.getTime()) / 60000, 0);
    const activeClasses = classes.filter((c) => c.status === 'ACTIVE');
    const status = teacher.status !== 'ACTIVE' ? teacher.status : activeClasses.length > 0 ? 'TEACHING' : 'AVAILABLE';
    return {
      teacher,
      teachingStatus: status,
      stats: {
        activeClasses: activeClasses.length,
        totalClasses: classes.length,
        activeStudents: new Set(students.map((s) => s.student.id)).size,
        sessionsThisMonth: taughtThisMonth.length,
        hoursThisMonth: Math.round((minutes / 60) * 10) / 10,
        upcomingSessions: upcoming.length,
      },
      classes: classes.map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status, startDate: dateToYmd(c.startDate), endDate: dateToYmd(c.endDate), course: c.course, room: c.room?.name ?? null, capacity: c.capacity, activeStudents: c._count.enrollments })),
      upcomingSessions: upcoming.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, topic: s.topic, status: s.status, classroom: s.classroom, room: s.room?.name ?? null })),
      students: students.map((e) => ({ ...e.student, classroom: e.classroom })),
    };
  }
}
