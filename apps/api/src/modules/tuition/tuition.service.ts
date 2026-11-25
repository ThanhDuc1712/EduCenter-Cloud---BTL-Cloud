import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PaymentMethod, Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { badRequest, conflict, notFound, unprocessable } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { AppException } from '../../common/errors/app-exception';
import { pageArgs, toPage } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';
import { addDaysYmd, dateToYmd, localDayRange, localYmd, ymdToDate } from '../../common/time';
import { invoiceStatus, nextInvoiceCode } from './invoice-code';

export interface InvoiceQuery {
  status?: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  studentId?: string;
  classroomId?: string;
  courseId?: string;
  overdue?: boolean;
  q?: string;
  page: number;
  pageSize: number;
}

const include = {
  student: { select: { id: true, code: true, fullName: true, phone: true } },
  classroom: { select: { id: true, code: true, name: true } },
  course: { select: { id: true, code: true, name: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof include }>;

function mapInvoice(i: InvoiceRow, today = localYmd()) {
  const due = i.amountVnd - i.discountVnd;
  const dueDate = dateToYmd(i.dueDate);
  return {
    id: i.id,
    code: i.code,
    description: i.description,
    amountVnd: i.amountVnd,
    discountVnd: i.discountVnd,
    totalDueVnd: due,
    paidVnd: i.paidVnd,
    remainingVnd: i.status === 'CANCELLED' ? 0n : due - i.paidVnd,
    dueDate,
    overdue: (i.status === 'UNPAID' || i.status === 'PARTIAL') && dueDate < today,
    status: i.status,
    issuedAt: i.issuedAt,
    student: i.student,
    classroom: i.classroom,
    course: i.course,
  };
}

@Injectable()
export class TuitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  private scope(p: Principal): Prisma.InvoiceWhereInput {
    return p.role === 'STUDENT' ? { tenantId: p.tenantId, studentId: p.studentId } : { tenantId: p.tenantId };
  }

  async list(p: Principal, q: InvoiceQuery) {
    const today = localYmd();
    const search = q.q?.trim();
    const where: Prisma.InvoiceWhereInput = {
      AND: [
        this.scope(p),
        q.status ? { status: q.status } : {},
        q.studentId ? { studentId: q.studentId } : {},
        q.classroomId ? { classroomId: q.classroomId } : {},
        q.courseId ? { courseId: q.courseId } : {},
        q.overdue ? { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: ymdToDate(today) } } : {},
        search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { student: { fullName: { contains: search, mode: 'insensitive' } } }, { student: { code: { contains: search, mode: 'insensitive' } } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: [{ dueDate: 'desc' }, { code: 'desc' }], ...pageArgs(q), include }),
      this.prisma.invoice.count({ where }),
    ]);
    return toPage(rows.map((r) => mapInvoice(r, today)), total, q);
  }

  async get(p: Principal, id: string) {
    const i = await this.prisma.invoice.findFirst({ where: { AND: [this.scope(p), { id }] }, include: { ...include, payments: { orderBy: { paidAt: 'desc' } } } });
    if (!i) throw notFound('khoản học phí');
    return { ...mapInvoice(i), payments: i.payments.map((x) => ({ id: x.id, amountVnd: x.amountVnd, method: x.method, paidAt: x.paidAt, note: x.note, receivedBy: x.receivedBy })) };
  }

  async create(p: Principal, dto: { studentId: string; classroomId?: string; courseId?: string; description: string; amountVnd: string; discountVnd?: string; dueDate: string }) {
    const amount = BigInt(dto.amountVnd);
    const discount = BigInt(dto.discountVnd ?? '0');
    if (discount > amount) throw badRequest('Giảm trừ không được lớn hơn số tiền', 'discountVnd');
    return this.tx.run(p, async (db) => {
      const student = await db.student.findFirst({ where: { tenantId: p.tenantId, id: dto.studentId } });
      if (!student) throw notFound('học viên');
      let courseId = dto.courseId ?? null;
      if (dto.classroomId) {
        const c = await db.classroom.findFirst({ where: { tenantId: p.tenantId, id: dto.classroomId } });
        if (!c) throw notFound('lớp học');
        courseId = courseId ?? c.courseId;
      }
      if (courseId && !(await db.course.findFirst({ where: { tenantId: p.tenantId, id: courseId } }))) throw notFound('khóa học');
      const inv = await db.invoice.create({
        data: { tenantId: p.tenantId, code: await nextInvoiceCode(db, p.tenantId), studentId: dto.studentId, classroomId: dto.classroomId ?? null, courseId, description: dto.description, amountVnd: amount, discountVnd: discount, dueDate: ymdToDate(dto.dueDate), status: amount - discount === 0n ? 'PAID' : 'UNPAID' },
        include,
      });
      await this.activity.notify(db, p.tenantId, { type: 'TUITION', title: `Khoản học phí ${inv.code}`, body: `${inv.description}: ${(amount - discount).toLocaleString('vi-VN')} ₫, hạn ${dto.dueDate}.`, link: '/tuition' }, [{ role: 'STUDENT', studentId: dto.studentId }]);
      await this.activity.record(db, p, { action: 'invoice.created', entityType: 'invoice', entityId: inv.id, summary: `Tạo khoản học phí ${inv.code} cho ${student.fullName}: ${(amount - discount).toLocaleString('vi-VN')} ₫` });
      return mapInvoice(inv);
    });
  }

  async update(p: Principal, id: string, dto: { description?: string; discountVnd?: string; dueDate?: string }) {
    return this.tx.run(p, async (db) => {
      const inv = await db.invoice.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!inv) throw notFound('khoản học phí');
      if (inv.status === 'CANCELLED') throw unprocessable('INVOICE_CANCELLED', 'Khoản học phí đã hủy');
      const discount = dto.discountVnd === undefined ? inv.discountVnd : BigInt(dto.discountVnd);
      if (discount > inv.amountVnd - inv.paidVnd) throw badRequest('Giảm trừ vượt quá số tiền còn lại', 'discountVnd');
      const u = await db.invoice.update({
        where: { id },
        data: { description: dto.description, discountVnd: discount, dueDate: dto.dueDate ? ymdToDate(dto.dueDate) : undefined, status: invoiceStatus(inv.amountVnd, discount, inv.paidVnd) },
        include,
      });
      await this.activity.record(db, p, { action: 'invoice.updated', entityType: 'invoice', entityId: id, summary: `Cập nhật khoản học phí ${inv.code}` });
      return mapInvoice(u);
    });
  }

  async cancel(p: Principal, id: string) {
    return this.tx.run(p, async (db) => {
      const inv = await db.invoice.findFirst({ where: { tenantId: p.tenantId, id } });
      if (!inv) throw notFound('khoản học phí');
      if (inv.paidVnd > 0n) throw unprocessable('INVOICE_HAS_PAYMENTS', 'Khoản học phí đã có thanh toán, không thể hủy');
      const u = await db.invoice.update({ where: { id }, data: { status: 'CANCELLED' }, include });
      await this.activity.record(db, p, { action: 'invoice.cancelled', entityType: 'invoice', entityId: id, summary: `Hủy khoản học phí ${inv.code}` });
      return mapInvoice(u);
    });
  }

  /**
   * Manual payment (partial or full). D-13: `Idempotency-Key` is mandatory — replaying the same key
   * with the same body returns the original payment; the same key with a different body → 409.
   * The invoice row is locked (FOR UPDATE) so concurrent payments cannot over-collect.
   */
  async pay(p: Principal, invoiceId: string, idempotencyKey: string | undefined, dto: { amountVnd: string; method: PaymentMethod; paidAt?: string; note?: string }) {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) {
      throw new AppException('IDEMPOTENCY_KEY_REQUIRED', HttpStatus.BAD_REQUEST, 'Thiếu hoặc sai định dạng header Idempotency-Key (8–64 ký tự)');
    }
    const amount = BigInt(dto.amountVnd);
    const requestHash = createHash('sha256').update(JSON.stringify({ invoiceId, amount: dto.amountVnd, method: dto.method, paidAt: dto.paidAt ?? null, note: dto.note ?? null })).digest('hex');

    return this.tx.run(p, async (db) => {
      const previous = await db.payment.findUnique({ where: { tenantId_idempotencyKey: { tenantId: p.tenantId, idempotencyKey } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng cho một yêu cầu khác');
        const inv = await db.invoice.findUniqueOrThrow({ where: { id: previous.invoiceId }, include });
        return { replayed: true, payment: { id: previous.id, amountVnd: previous.amountVnd, method: previous.method, paidAt: previous.paidAt }, invoice: mapInvoice(inv) };
      }
      await db.$queryRaw`SELECT id FROM invoices WHERE tenant_id = ${p.tenantId}::uuid AND id = ${invoiceId}::uuid FOR UPDATE`;
      const inv = await db.invoice.findFirst({ where: { tenantId: p.tenantId, id: invoiceId }, include: { student: true } });
      if (!inv) throw notFound('khoản học phí');
      if (inv.status === 'CANCELLED') throw unprocessable('INVOICE_CANCELLED', 'Khoản học phí đã hủy');
      const remaining = inv.amountVnd - inv.discountVnd - inv.paidVnd;
      if (remaining <= 0n) throw unprocessable('INVOICE_ALREADY_PAID', 'Khoản học phí đã thanh toán đủ');
      if (amount > remaining) throw unprocessable('PAYMENT_EXCEEDS_BALANCE', `Số tiền vượt quá số còn nợ (${remaining.toLocaleString('vi-VN')} ₫)`);

      const payment = await db.payment.create({
        data: { tenantId: p.tenantId, invoiceId, amountVnd: amount, method: dto.method, paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(), note: dto.note, receivedBy: p.displayName, idempotencyKey, requestHash },
      });
      const paid = inv.paidVnd + amount;
      const updated = await db.invoice.update({ where: { id: invoiceId }, data: { paidVnd: paid, status: invoiceStatus(inv.amountVnd, inv.discountVnd, paid) }, include });
      await this.activity.notify(db, p.tenantId, { type: 'TUITION', title: `Đã nhận thanh toán ${inv.code}`, body: `Trung tâm đã nhận ${amount.toLocaleString('vi-VN')} ₫. ${updated.status === 'PAID' ? 'Khoản học phí đã thanh toán đủ.' : `Còn lại ${(remaining - amount).toLocaleString('vi-VN')} ₫.`}`, link: '/tuition' }, [{ role: 'STUDENT', studentId: inv.studentId }]);
      await this.activity.record(db, p, { action: 'payment.recorded', entityType: 'invoice', entityId: invoiceId, summary: `Thu ${amount.toLocaleString('vi-VN')} ₫ (${dto.method}) khoản ${inv.code} – ${inv.student.fullName}` });
      return { replayed: false, payment: { id: payment.id, amountVnd: payment.amountVnd, method: payment.method, paidAt: payment.paidAt }, invoice: mapInvoice(updated) };
    });
  }

  async payments(p: Principal, q: { from?: string; to?: string; method?: PaymentMethod; studentId?: string; page: number; pageSize: number }) {
    const range = q.from || q.to ? localDayRange(q.from ?? '2000-01-01', q.to ?? localYmd()) : undefined;
    const where: Prisma.PaymentWhereInput = {
      AND: [
        { tenantId: p.tenantId },
        p.role === 'STUDENT' ? { invoice: { studentId: p.studentId } } : {},
        q.studentId ? { invoice: { studentId: q.studentId } } : {},
        q.method ? { method: q.method } : {},
        range ? { paidAt: { gte: range.start, lt: range.end } } : {},
      ],
    };
    const [rows, total, sum] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { paidAt: 'desc' }, ...pageArgs(q), include: { invoice: { select: { id: true, code: true, description: true, student: { select: { id: true, code: true, fullName: true } } } } } }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amountVnd: true } }),
    ]);
    return { ...toPage(rows.map((x) => ({ id: x.id, amountVnd: x.amountVnd, method: x.method, paidAt: x.paidAt, note: x.note, receivedBy: x.receivedBy, invoice: x.invoice })), total, q), totalVnd: sum._sum.amountVnd ?? 0n };
  }

  /** Billed / collected / outstanding / overdue + monthly revenue and per-course breakdown. */
  async summary(p: Principal, months = 6) {
    const today = localYmd();
    const scope = this.scope(p);
    const open: Prisma.InvoiceWhereInput = { ...scope, status: { not: 'CANCELLED' } };
    const [agg, overdue, byStatus, payments, byCourse] = await Promise.all([
      this.prisma.invoice.aggregate({ where: open, _sum: { amountVnd: true, discountVnd: true, paidVnd: true }, _count: true }),
      this.prisma.invoice.findMany({ where: { ...scope, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: ymdToDate(today) } }, select: { amountVnd: true, discountVnd: true, paidVnd: true } }),
      this.prisma.invoice.groupBy({ by: ['status'], where: scope, _count: true }),
      this.prisma.payment.findMany({ where: { tenantId: p.tenantId, ...(p.role === 'STUDENT' ? { invoice: { studentId: p.studentId } } : {}), paidAt: { gte: localDayRange(`${addDaysYmd(today, -31 * (months - 1)).slice(0, 8)}01`).start } }, select: { amountVnd: true, paidAt: true } }),
      p.role === 'STUDENT' ? Promise.resolve([]) : this.prisma.invoice.groupBy({ by: ['courseId'], where: open, _sum: { amountVnd: true, discountVnd: true, paidVnd: true } }),
    ]);
    const billed = (agg._sum.amountVnd ?? 0n) - (agg._sum.discountVnd ?? 0n);
    const collected = agg._sum.paidVnd ?? 0n;
    const monthly = new Map<string, bigint>();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(`${today.slice(0, 7)}-15T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      monthly.set(d.toISOString().slice(0, 7), 0n);
    }
    for (const pay of payments) {
      const key = localYmd(pay.paidAt).slice(0, 7);
      if (monthly.has(key)) monthly.set(key, monthly.get(key)! + pay.amountVnd);
    }
    const courses = byCourse.length ? await this.prisma.course.findMany({ where: { tenantId: p.tenantId, id: { in: byCourse.map((c) => c.courseId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }) : [];
    const courseName = new Map(courses.map((c) => [c.id, c]));
    return {
      invoiceCount: agg._count,
      billedVnd: billed,
      collectedVnd: collected,
      outstandingVnd: billed - collected,
      collectionRate: billed > 0n ? Math.round(Number((collected * 1000n) / billed)) / 10 : 0,
      overdue: { count: overdue.length, amountVnd: overdue.reduce((s, i) => s + i.amountVnd - i.discountVnd - i.paidVnd, 0n) },
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      revenueByMonth: [...monthly].map(([month, amountVnd]) => ({ month, amountVnd })),
      byCourse: byCourse.map((c) => ({ course: c.courseId ? courseName.get(c.courseId) ?? null : null, billedVnd: (c._sum.amountVnd ?? 0n) - (c._sum.discountVnd ?? 0n), collectedVnd: c._sum.paidVnd ?? 0n })),
    };
  }
}
