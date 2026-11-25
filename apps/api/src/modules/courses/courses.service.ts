import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { classroomScope, conflict, notFound } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';
import { dateToYmd } from '../../common/time';
import type { CourseQueryDto, CreateCourseDto, CreateRoomDto, UpdateCourseDto, UpdateRoomDto } from './courses.dto';

/** Courses visible to a role: admin = all; teacher/student = courses of their classes (non-draft). */
function courseScope(p: Principal): Prisma.CourseWhereInput {
  if (p.role === 'ADMIN') return { tenantId: p.tenantId };
  return { tenantId: p.tenantId, status: { not: 'DRAFT' }, classrooms: { some: classroomScope(p) } };
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  async list(p: Principal, q: CourseQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.CourseWhereInput = {
      AND: [
        courseScope(p),
        q.status ? { status: q.status } : {},
        search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.course.findMany({ where, orderBy: [{ status: 'asc' }, { code: 'asc' }], ...pageArgs(q), include: { _count: { select: { classrooms: true, materials: { where: { status: 'READY' } } } } } }),
      this.prisma.course.count({ where }),
    ]);
    const studentCounts = await this.activeStudentCounts(p.tenantId, rows.map((r) => r.id));
    return toPage(
      rows.map((c) => ({ ...this.map(c), classCount: c._count.classrooms, materialCount: c._count.materials, activeStudents: studentCounts.get(c.id) ?? 0 })),
      total,
      q,
    );
  }

  private async activeStudentCounts(tenantId: string, courseIds: string[]): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();
    const rows = await this.prisma.enrollment.findMany({
      where: { tenantId, status: 'ACTIVE', classroom: { courseId: { in: courseIds } } },
      select: { studentId: true, classroom: { select: { courseId: true } } },
    });
    const sets = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = sets.get(r.classroom.courseId) ?? new Set<string>();
      set.add(r.studentId);
      sets.set(r.classroom.courseId, set);
    }
    return new Map([...sets].map(([k, v]) => [k, v.size]));
  }

  private map(c: Prisma.CourseGetPayload<object>) {
    return { id: c.id, code: c.code, name: c.name, description: c.description, content: c.content, level: c.level, tuitionVnd: c.tuitionVnd, durationHours: c.durationHours, totalSessions: c.totalSessions, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }

  async get(p: Principal, id: string) {
    const c = await this.prisma.course.findFirst({ where: { AND: [courseScope(p), { id }] } });
    if (!c) throw notFound('khóa học');
    const [classes, counts] = await Promise.all([
      this.prisma.classroom.findMany({
        where: { AND: [classroomScope(p), { courseId: id }] },
        orderBy: { startDate: 'desc' },
        include: { teacher: { select: { id: true, fullName: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      }),
      this.activeStudentCounts(p.tenantId, [id]),
    ]);
    return {
      ...this.map(c),
      activeStudents: counts.get(id) ?? 0,
      classes: classes.map((k) => ({ id: k.id, code: k.code, name: k.name, status: k.status, startDate: dateToYmd(k.startDate), endDate: dateToYmd(k.endDate), capacity: k.capacity, teacher: k.teacher, activeStudents: k._count.enrollments })),
    };
  }

  async create(p: Principal, dto: CreateCourseDto) {
    return this.tx.run(p, async (db) => {
      if (await db.course.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } })) throw conflict('COURSE_CODE_EXISTS', `Mã khóa học ${dto.code} đã tồn tại`);
      const c = await db.course.create({ data: { tenantId: p.tenantId, ...dto, tuitionVnd: BigInt(dto.tuitionVnd) } });
      await this.activity.record(db, p, { action: 'course.created', entityType: 'course', entityId: c.id, summary: `Tạo khóa học ${c.name} (${c.code})` });
      return this.map(c);
    });
  }

  async update(p: Principal, id: string, dto: UpdateCourseDto) {
    return this.tx.run(p, async (db) => {
      const existing = await db.course.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!existing) throw notFound('khóa học');
      if (dto.code && dto.code !== existing.code && (await db.course.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } }))) {
        throw conflict('COURSE_CODE_EXISTS', `Mã khóa học ${dto.code} đã tồn tại`);
      }
      const c = await db.course.update({ where: { id }, data: { ...dto, tuitionVnd: dto.tuitionVnd === undefined ? undefined : BigInt(dto.tuitionVnd) } });
      const verb = dto.status === 'ARCHIVED' ? 'Lưu trữ' : 'Cập nhật';
      await this.activity.record(db, p, { action: dto.status === 'ARCHIVED' ? 'course.archived' : 'course.updated', entityType: 'course', entityId: c.id, summary: `${verb} khóa học ${c.name}` });
      return this.map(c);
    });
  }

  /** Hard delete only for courses that were never used; otherwise archive. */
  async remove(p: Principal, id: string) {
    return this.tx.run(p, async (db) => {
      const c = await db.course.findFirst({ where: { tenantId: p.tenantId, id }, include: { _count: { select: { classrooms: true, invoices: true, materials: true } } } });
      if (!c) throw notFound('khóa học');
      if (c._count.classrooms + c._count.invoices + c._count.materials > 0) {
        throw conflict('COURSE_IN_USE', 'Khóa học đã có lớp, học phí hoặc tài liệu — hãy lưu trữ thay vì xóa');
      }
      await db.course.delete({ where: { id } });
      await this.activity.record(db, p, { action: 'course.deleted', entityType: 'course', entityId: id, summary: `Xóa khóa học ${c.name}` });
      return { deleted: true };
    });
  }

  // ───── Rooms ─────
  rooms(p: Principal) {
    return this.prisma.room.findMany({ where: { tenantId: p.tenantId }, orderBy: { name: 'asc' } });
  }

  async createRoom(p: Principal, dto: CreateRoomDto) {
    return this.tx.run(p, async (db) => {
      if (await db.room.findUnique({ where: { tenantId_name: { tenantId: p.tenantId, name: dto.name } } })) throw conflict('ROOM_NAME_EXISTS', `Phòng ${dto.name} đã tồn tại`);
      const r = await db.room.create({ data: { tenantId: p.tenantId, ...dto } });
      await this.activity.record(db, p, { action: 'room.created', entityType: 'room', entityId: r.id, summary: `Thêm phòng học ${r.name}` });
      return r;
    });
  }

  async updateRoom(p: Principal, id: string, dto: UpdateRoomDto) {
    return this.tx.run(p, async (db) => {
      const existing = await db.room.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!existing) throw notFound('phòng học');
      if (dto.name && dto.name !== existing.name && (await db.room.findUnique({ where: { tenantId_name: { tenantId: p.tenantId, name: dto.name } } }))) {
        throw conflict('ROOM_NAME_EXISTS', `Phòng ${dto.name} đã tồn tại`);
      }
      return db.room.update({ where: { id }, data: dto });
    });
  }
}
