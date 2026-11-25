import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import { classroomScope, conflict, notFound, unprocessable } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto, pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';
import { addDaysYmd, dateToYmd, localYmd, ymdToDate } from '../../common/time';
import { nextInvoiceCode } from '../tuition/invoice-code';

const ENROLLMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'DROPPED', 'CANCELLED'] as const;
type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

class EnrollmentQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsIn(ENROLLMENT_STATUSES) status?: EnrollmentStatus;
}

class CreateEnrollmentDto {
  @IsUUID() classroomId: string;
  @IsUUID() studentId: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Create the tuition invoice for this class (default true). */
  @IsOptional() @IsBoolean() createInvoice?: boolean;
}

class UpdateEnrollmentDto {
  @IsOptional() @IsIn(ENROLLMENT_STATUSES) status?: EnrollmentStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Allowed status transitions of an enrollment. */
const TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  ACTIVE: ['COMPLETED', 'DROPPED', 'CANCELLED'],
  DROPPED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: ['ACTIVE'],
  COMPLETED: ['ACTIVE'],
};

const include = {
  student: { select: { id: true, code: true, fullName: true, phone: true, status: true } },
  classroom: { select: { id: true, code: true, name: true, status: true, capacity: true, course: { select: { id: true, name: true } } } },
} satisfies Prisma.EnrollmentInclude;

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  async list(p: Principal, q: EnrollmentQueryDto) {
    const search = q.q?.trim();
    const where: Prisma.EnrollmentWhereInput = {
      AND: [
        { tenantId: p.tenantId, classroom: classroomScope(p) },
        p.role === 'STUDENT' ? { studentId: p.studentId } : {},
        q.classroomId ? { classroomId: q.classroomId } : {},
        q.studentId ? { studentId: q.studentId } : {},
        q.status ? { status: q.status } : {},
        search ? { OR: [{ student: { fullName: { contains: search, mode: 'insensitive' } } }, { student: { code: { contains: search, mode: 'insensitive' } } }, { classroom: { code: { contains: search, mode: 'insensitive' } } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.enrollment.findMany({ where, orderBy: { enrolledAt: 'desc' }, ...pageArgs(q), include }),
      this.prisma.enrollment.count({ where }),
    ]);
    return toPage(rows, total, q);
  }

  /** Locks the classroom row, then counts ACTIVE enrollments so concurrent enrollments cannot overfill a class. */
  private async lockAndCheckCapacity(db: Prisma.TransactionClient, tenantId: string, classroomId: string) {
    await db.$queryRaw`SELECT id FROM classrooms WHERE tenant_id = ${tenantId}::uuid AND id = ${classroomId}::uuid FOR UPDATE`;
    const c = await db.classroom.findFirst({ where: { tenantId, id: classroomId }, include: { course: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } });
    if (!c) throw notFound('lớp học');
    if (c.status === 'COMPLETED' || c.status === 'CANCELLED') throw unprocessable('CLASSROOM_CLOSED', `Lớp ${c.code} đã kết thúc hoặc đã hủy`);
    if (c._count.enrollments >= c.capacity) throw conflict('CLASSROOM_FULL', `Lớp ${c.code} đã đủ ${c.capacity} học viên`);
    return c;
  }

  async create(p: Principal, dto: CreateEnrollmentDto) {
    return this.tx.run(p, async (db) => {
      const student = await db.student.findFirst({ where: { tenantId: p.tenantId, id: dto.studentId } });
      if (!student) throw notFound('học viên');
      if (student.status !== 'ACTIVE') throw unprocessable('STUDENT_NOT_ACTIVE', `Học viên ${student.fullName} đang không hoạt động`);
      const c = await this.lockAndCheckCapacity(db, p.tenantId, dto.classroomId);

      const existing = await db.enrollment.findUnique({ where: { tenantId_classroomId_studentId: { tenantId: p.tenantId, classroomId: dto.classroomId, studentId: dto.studentId } } });
      if (existing?.status === 'ACTIVE' || existing?.status === 'COMPLETED') throw conflict('ENROLLMENT_DUPLICATE', `${student.fullName} đã đăng ký lớp ${c.code}`);
      const enrollment = existing
        ? await db.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', endedAt: null, enrolledAt: new Date(), note: dto.note ?? existing.note }, include })
        : await db.enrollment.create({ data: { tenantId: p.tenantId, classroomId: dto.classroomId, studentId: dto.studentId, note: dto.note }, include });

      let invoice = null;
      const amount = c.tuitionVnd ?? c.course.tuitionVnd;
      if (dto.createInvoice !== false && amount > 0n) {
        const open = await db.invoice.findFirst({ where: { tenantId: p.tenantId, studentId: dto.studentId, classroomId: dto.classroomId, status: { not: 'CANCELLED' } } });
        if (!open) {
          const start = dateToYmd(c.startDate);
          const due = [addDaysYmd(localYmd(), 7), addDaysYmd(start, 14)].sort().at(-1)!;
          invoice = await db.invoice.create({
            data: { tenantId: p.tenantId, code: await nextInvoiceCode(db, p.tenantId), studentId: dto.studentId, classroomId: c.id, courseId: c.courseId, description: `Học phí ${c.name}`, amountVnd: amount, dueDate: ymdToDate(due) },
          });
          await this.activity.notify(db, p.tenantId, { type: 'TUITION', title: `Học phí lớp ${c.code}`, body: `Khoản học phí ${amount.toLocaleString('vi-VN')} ₫ cho lớp ${c.name}, hạn nộp ${due}.`, link: '/tuition' }, [{ role: 'STUDENT', studentId: dto.studentId }]);
        }
      }
      await this.activity.notify(db, p.tenantId, { type: 'CLASS', title: `Đăng ký lớp ${c.code} thành công`, body: `Bạn đã được ghi danh vào lớp ${c.name}, khai giảng ${dateToYmd(c.startDate)}.`, link: `/classes/${c.id}` }, [{ role: 'STUDENT', studentId: dto.studentId }]);
      await this.activity.record(db, p, { action: 'enrollment.created', entityType: 'enrollment', entityId: enrollment.id, summary: `Ghi danh ${student.fullName} vào lớp ${c.code}` });
      return { ...enrollment, invoice };
    });
  }

  async update(p: Principal, id: string, dto: UpdateEnrollmentDto) {
    return this.tx.run(p, async (db) => {
      const e = await db.enrollment.findFirst({ where: { tenantId: p.tenantId, id }, include });
      if (!e) throw notFound('đăng ký');
      if (dto.status && dto.status !== e.status) {
        if (!TRANSITIONS[e.status].includes(dto.status)) throw unprocessable('INVALID_TRANSITION', `Không thể chuyển đăng ký từ ${e.status} sang ${dto.status}`);
        if (dto.status === 'ACTIVE') await this.lockAndCheckCapacity(db, p.tenantId, e.classroomId);
      }
      const ended = dto.status && dto.status !== 'ACTIVE' ? new Date() : dto.status === 'ACTIVE' ? null : undefined;
      const updated = await db.enrollment.update({ where: { id }, data: { status: dto.status, note: dto.note, endedAt: ended }, include });
      if (dto.status === 'CANCELLED') {
        // An unpaid invoice of a cancelled enrollment is cancelled too; paid ones are kept for refund handling.
        await db.invoice.updateMany({ where: { tenantId: p.tenantId, studentId: e.studentId, classroomId: e.classroomId, status: 'UNPAID', paidVnd: 0n }, data: { status: 'CANCELLED' } });
      }
      await this.activity.record(db, p, { action: 'enrollment.updated', entityType: 'enrollment', entityId: id, summary: `Đăng ký ${e.student.fullName} – lớp ${e.classroom.code}: ${dto.status ?? 'cập nhật ghi chú'}` });
      return updated;
    });
  }
}

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: EnrollmentQueryDto) {
    return this.enrollments.list(p, q);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateEnrollmentDto) {
    return this.enrollments.create(p, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.enrollments.update(p, id, dto);
  }

  @Post(':id/cancel')
  @Roles('ADMIN')
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.update(p, id, { status: 'CANCELLED' });
  }
}

@Module({ controllers: [EnrollmentsController], providers: [EnrollmentsService] })
export class EnrollmentsModule {}
