import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { conflict, notFound, studentScope } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx, lockSequence } from '../../common/prisma/tenant-tx';
import { addDaysYmd, dateToYmd, localDayRange, localYmd, ymdToDate } from '../../common/time';
import { GradesService } from '../grades/grades.service';
import { AttendanceService } from '../attendance/attendance.service';
import type { CreateStudentDto, StudentQueryDto, UpdateStudentDto } from './students.dto';

type StudentRow = Prisma.StudentGetPayload<object>;

export function mapStudent(s: StudentRow, full = true) {
  return {
    id: s.id,
    code: s.code,
    fullName: s.fullName,
    email: s.email,
    phone: s.phone,
    status: s.status,
    ...(full
      ? {
          dateOfBirth: s.dateOfBirth ? dateToYmd(s.dateOfBirth) : null,
          gender: s.gender,
          address: s.address,
          guardianName: s.guardianName,
          guardianPhone: s.guardianPhone,
          note: s.note,
        }
      : {}),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Next HV#### code for the tenant (serialized by an advisory lock). Also used by self-registration. */
export async function nextStudentCode(db: Prisma.TransactionClient, tenantId: string): Promise<string> {
  await lockSequence(db, tenantId, 'student-code');
  const last = await db.student.findFirst({ where: { tenantId, code: { startsWith: 'HV' } }, orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number(last.code.replace(/\D/g, '')) || 0 : 0;
  return `HV${String(n + 1).padStart(4, '0')}`;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
    private readonly grades: GradesService,
    private readonly attendance: AttendanceService,
  ) {}

  async list(p: Principal, q: StudentQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.StudentWhereInput = {
      AND: [
        studentScope(p),
        q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } },
        q.classroomId ? { enrollments: { some: { classroomId: q.classroomId, status: 'ACTIVE' } } } : {},
        search
          ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: { code: 'asc' },
        ...pageArgs(q),
        include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      }),
      this.prisma.student.count({ where }),
    ]);
    const full = p.role === 'ADMIN';
    return toPage(rows.map((s) => ({ ...mapStudent(s, full), activeEnrollments: s._count.enrollments })), total, q);
  }

  async get(p: Principal, id: string) {
    const s = await this.prisma.student.findFirst({ where: { AND: [studentScope(p), { id }] } });
    if (!s) throw notFound('học viên');
    return mapStudent(s, p.role !== 'TEACHER');
  }

  private nextCode(db: Prisma.TransactionClient, tenantId: string): Promise<string> {
    return nextStudentCode(db, tenantId);
  }

  async create(p: Principal, dto: CreateStudentDto) {
    return this.tx.run(p, async (db) => {
      const code = dto.code ?? (await this.nextCode(db, p.tenantId));
      if (await db.student.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code } } })) throw conflict('STUDENT_CODE_EXISTS', `Mã học viên ${code} đã tồn tại`);
      const s = await db.student.create({
        data: { tenantId: p.tenantId, ...dto, code, dateOfBirth: dto.dateOfBirth ? ymdToDate(dto.dateOfBirth) : null },
      });
      await this.activity.record(db, p, { action: 'student.created', entityType: 'student', entityId: s.id, summary: `Thêm học viên ${s.fullName} (${s.code})` });
      return mapStudent(s);
    });
  }

  async update(p: Principal, id: string, dto: UpdateStudentDto) {
    return this.tx.run(p, async (db) => {
      const existing = await db.student.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!existing) throw notFound('học viên');
      if (dto.code && dto.code !== existing.code && (await db.student.findUnique({ where: { tenantId_code: { tenantId: p.tenantId, code: dto.code } } }))) {
        throw conflict('STUDENT_CODE_EXISTS', `Mã học viên ${dto.code} đã tồn tại`);
      }
      const s = await db.student.update({
        where: { id },
        data: { ...dto, dateOfBirth: dto.dateOfBirth === undefined ? undefined : ymdToDate(dto.dateOfBirth) },
      });
      const action = dto.status && dto.status !== existing.status ? `student.status.${dto.status.toLowerCase()}` : 'student.updated';
      const label = dto.status === 'ARCHIVED' ? 'Lưu trữ' : dto.status === 'INACTIVE' ? 'Vô hiệu hóa' : dto.status === 'ACTIVE' && existing.status !== 'ACTIVE' ? 'Kích hoạt lại' : 'Cập nhật';
      await this.activity.record(db, p, { action, entityType: 'student', entityId: s.id, summary: `${label} học viên ${s.fullName} (${s.code})` });
      return mapStudent(s);
    });
  }

  /** Everything the student detail page needs in one call (scoped). */
  async overview(p: Principal, id: string) {
    const student = await this.get(p, id);
    const today = localYmd();
    const range = localDayRange(today, addDaysYmd(today, 13));
    const enrollmentWhere: Prisma.EnrollmentWhereInput = { tenantId: p.tenantId, studentId: id, ...(p.role === 'TEACHER' ? { classroom: { teacherId: p.teacherId } } : {}) };

    const [enrollments, upcoming, invoices, gradeSummary, attendanceSummary] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: enrollmentWhere,
        orderBy: { enrolledAt: 'desc' },
        include: { classroom: { select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true, course: { select: { id: true, name: true } }, teacher: { select: { id: true, fullName: true } } } } },
      }),
      this.prisma.classSession.findMany({
        where: { tenantId: p.tenantId, status: { not: 'CANCELLED' }, startsAt: { gte: range.start, lt: range.end }, classroom: { enrollments: { some: { studentId: id, status: 'ACTIVE' } }, ...(p.role === 'TEACHER' ? { teacherId: p.teacherId } : {}) } },
        orderBy: { startsAt: 'asc' },
        take: 30,
        include: { classroom: { select: { id: true, code: true, name: true } }, room: { select: { name: true } }, teacher: { select: { fullName: true } } },
      }),
      p.role === 'TEACHER'
        ? Promise.resolve([])
        : this.prisma.invoice.findMany({ where: { tenantId: p.tenantId, studentId: id }, orderBy: { dueDate: 'desc' }, include: { classroom: { select: { code: true, name: true } } } }),
      this.grades.studentGrades(p, id),
      this.attendance.studentSummary(p, id),
    ]);

    const billed = invoices.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + i.amountVnd - i.discountVnd, 0n);
    const paid = invoices.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + i.paidVnd, 0n);
    return {
      student,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        status: e.status,
        enrolledAt: e.enrolledAt,
        endedAt: e.endedAt,
        classroom: { ...e.classroom, startDate: dateToYmd(e.classroom.startDate), endDate: dateToYmd(e.classroom.endDate) },
      })),
      upcomingSessions: upcoming.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, topic: s.topic, status: s.status, classroom: s.classroom, room: s.room?.name ?? null, teacher: s.teacher?.fullName ?? null })),
      grades: gradeSummary,
      attendance: attendanceSummary,
      tuition:
        p.role === 'TEACHER'
          ? null
          : {
              billedVnd: billed,
              paidVnd: paid,
              outstandingVnd: billed - paid,
              invoices: invoices.map((i) => ({ id: i.id, code: i.code, description: i.description, amountVnd: i.amountVnd, discountVnd: i.discountVnd, paidVnd: i.paidVnd, dueDate: dateToYmd(i.dueDate), status: i.status, classroom: i.classroom })),
            },
    };
  }
}
