import { Controller, Get, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import type { AttendanceStatus } from '../../generated/prisma/client';
import { CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import { badRequest } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { IsYmd } from '../../common/http/validators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addDaysYmd, dateToYmd, localDayRange, localYmd, ymdToDate } from '../../common/time';
import { countAttendance } from '../attendance/attendance.service';
import { classify, weightedAverage } from '../grades/grades.service';
import { GradesModule } from '../grades/grades.module';
import { GradesService } from '../grades/grades.service';

export const REPORT_KINDS = ['students', 'teachers', 'courses', 'classes', 'attendance', 'grades', 'revenue', 'debts'] as const;
type ReportKind = (typeof REPORT_KINDS)[number];

class ReportQueryDto {
  @IsOptional() @IsYmd() from?: string;
  @IsOptional() @IsYmd() to?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

interface Column {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'percent' | 'date';
}

export interface Report {
  kind: ReportKind;
  title: string;
  from: string;
  to: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  summary: { label: string; value: string | number }[];
}

const pct = (n: number) => Math.round(n * 10) / 10;
const money = (b: bigint) => b.toString();

export function toCsv(report: Report): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formula injection and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [report.columns.map((c) => esc(c.label)).join(',')];
  for (const row of report.rows) lines.push(report.columns.map((c) => esc(row[c.key])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grades: GradesService,
  ) {}

  async build(p: Principal, kind: ReportKind, fromQ?: string, toQ?: string): Promise<Report> {
    const to = toQ ?? localYmd();
    const from = fromQ ?? addDaysYmd(to, -89);
    if (to < from) throw badRequest('to phải sau from');
    const range = localDayRange(from, to);
    const t = p.tenantId;
    const base = { kind, from, to };

    switch (kind) {
      case 'students': {
        const [students, attendance, invoices] = await Promise.all([
          this.prisma.student.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' }, include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } }),
          this.prisma.attendance.findMany({ where: { tenantId: t, session: { startsAt: { gte: range.start, lt: range.end } } }, select: { studentId: true, status: true } }),
          this.prisma.invoice.findMany({ where: { tenantId: t, status: { in: ['UNPAID', 'PARTIAL'] } }, select: { studentId: true, amountVnd: true, discountVnd: true, paidVnd: true } }),
        ]);
        const att = group(attendance, (a) => a.studentId);
        const debt = new Map<string, bigint>();
        for (const i of invoices) debt.set(i.studentId, (debt.get(i.studentId) ?? 0n) + i.amountVnd - i.discountVnd - i.paidVnd);
        const created = students.filter((s) => s.createdAt >= range.start && s.createdAt < range.end).length;
        return {
          ...base,
          title: 'Báo cáo học viên',
          columns: [col('code', 'Mã HV'), col('fullName', 'Họ tên'), col('status', 'Trạng thái'), col('phone', 'Điện thoại'), col('email', 'Email'), col('activeClasses', 'Lớp đang học', 'number'), col('attendanceRate', 'Chuyên cần (%)', 'percent'), col('outstandingVnd', 'Công nợ (VND)', 'money')],
          rows: students.map((s) => ({ code: s.code, fullName: s.fullName, status: s.status, phone: s.phone, email: s.email, activeClasses: s._count.enrollments, attendanceRate: att.has(s.id) ? countAttendance(att.get(s.id)!.map((a) => a.status)).rate : null, outstandingVnd: money(debt.get(s.id) ?? 0n) })),
          summary: [
            { label: 'Tổng học viên', value: students.length },
            { label: 'Đang hoạt động', value: students.filter((s) => s.status === 'ACTIVE').length },
            { label: 'Mới trong kỳ', value: created },
            { label: 'Có công nợ', value: [...debt.values()].filter((v) => v > 0n).length },
          ],
        };
      }
      case 'teachers': {
        const [teachers, sessions] = await Promise.all([
          this.prisma.teacher.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' }, include: { classrooms: { where: { status: { in: ['ACTIVE', 'PLANNED'] } }, select: { id: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } } } }),
          this.prisma.classSession.findMany({ where: { tenantId: t, status: 'COMPLETED', startsAt: { gte: range.start, lt: range.end } }, select: { teacherId: true, startsAt: true, endsAt: true } }),
        ]);
        const byTeacher = group(sessions, (s) => s.teacherId ?? '');
        return {
          ...base,
          title: 'Báo cáo giáo viên',
          columns: [col('code', 'Mã GV'), col('fullName', 'Họ tên'), col('specialization', 'Chuyên môn'), col('status', 'Trạng thái'), col('activeClasses', 'Lớp phụ trách', 'number'), col('students', 'Học viên', 'number'), col('sessions', 'Buổi đã dạy (kỳ)', 'number'), col('hours', 'Giờ dạy (kỳ)', 'number')],
          rows: teachers.map((x) => {
            const ss = byTeacher.get(x.id) ?? [];
            return { code: x.code, fullName: x.fullName, specialization: x.specialization, status: x.status, activeClasses: x.classrooms.length, students: x.classrooms.reduce((s, c) => s + c._count.enrollments, 0), sessions: ss.length, hours: pct(ss.reduce((s, y) => s + (y.endsAt.getTime() - y.startsAt.getTime()) / 3_600_000, 0)) };
          }),
          summary: [
            { label: 'Tổng giáo viên', value: teachers.length },
            { label: 'Đang giảng dạy', value: teachers.filter((x) => x.classrooms.length > 0).length },
            { label: 'Tổng buổi đã dạy', value: sessions.length },
          ],
        };
      }
      case 'courses': {
        const [courses, enrollments, invoices] = await Promise.all([
          this.prisma.course.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' }, include: { _count: { select: { classrooms: true } } } }),
          this.prisma.enrollment.findMany({ where: { tenantId: t, status: 'ACTIVE' }, select: { studentId: true, classroom: { select: { courseId: true } } } }),
          this.prisma.invoice.groupBy({ by: ['courseId'], where: { tenantId: t, status: { not: 'CANCELLED' } }, _sum: { amountVnd: true, discountVnd: true, paidVnd: true } }),
        ]);
        const students = group(enrollments, (e) => e.classroom.courseId);
        const fin = new Map(invoices.map((i) => [i.courseId, i._sum]));
        return {
          ...base,
          title: 'Báo cáo khóa học',
          columns: [col('code', 'Mã'), col('name', 'Khóa học'), col('status', 'Trạng thái'), col('tuitionVnd', 'Học phí (VND)', 'money'), col('classes', 'Số lớp', 'number'), col('activeStudents', 'Học viên đang học', 'number'), col('billedVnd', 'Phải thu (VND)', 'money'), col('collectedVnd', 'Đã thu (VND)', 'money')],
          rows: courses.map((c) => {
            const f = fin.get(c.id);
            return { code: c.code, name: c.name, status: c.status, tuitionVnd: money(c.tuitionVnd), classes: c._count.classrooms, activeStudents: new Set((students.get(c.id) ?? []).map((e) => e.studentId)).size, billedVnd: money((f?.amountVnd ?? 0n) - (f?.discountVnd ?? 0n)), collectedVnd: money(f?.paidVnd ?? 0n) };
          }),
          summary: [
            { label: 'Tổng khóa học', value: courses.length },
            { label: 'Đang mở', value: courses.filter((c) => c.status === 'ACTIVE').length },
          ],
        };
      }
      case 'classes':
      case 'attendance': {
        const classes = await this.prisma.classroom.findMany({
          where: { tenantId: t, startDate: { lte: ymdToDate(to) }, endDate: { gte: ymdToDate(from) } },
          orderBy: { code: 'asc' },
          include: { course: { select: { name: true } }, teacher: { select: { fullName: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
        });
        const ids = classes.map((c) => c.id);
        const [sessions, attendance] = await Promise.all([
          this.prisma.classSession.findMany({ where: { tenantId: t, classroomId: { in: ids }, status: { not: 'CANCELLED' }, startsAt: { gte: range.start, lt: range.end } }, select: { classroomId: true, startsAt: true } }),
          this.prisma.attendance.findMany({ where: { tenantId: t, session: { classroomId: { in: ids }, startsAt: { gte: range.start, lt: range.end } } }, select: { status: true, session: { select: { classroomId: true } } } }),
        ]);
        const sessionsBy = group(sessions, (s) => s.classroomId);
        const attBy = group(attendance, (a) => a.session.classroomId);
        const now = Date.now();
        if (kind === 'attendance') {
          const rows = classes.map((c) => {
            const counts = countAttendance((attBy.get(c.id) ?? []).map((a) => a.status as AttendanceStatus));
            return { code: c.code, name: c.name, teacher: c.teacher?.fullName ?? null, sessions: (sessionsBy.get(c.id) ?? []).filter((s) => s.startsAt.getTime() <= now).length, records: counts.total, present: counts.present, late: counts.late, absent: counts.absent, excused: counts.excused, rate: counts.rate };
          });
          const all = countAttendance(attendance.map((a) => a.status));
          return {
            ...base,
            title: 'Báo cáo chuyên cần',
            columns: [col('code', 'Mã lớp'), col('name', 'Lớp'), col('teacher', 'Giáo viên'), col('sessions', 'Buổi đã học', 'number'), col('records', 'Lượt điểm danh', 'number'), col('present', 'Có mặt', 'number'), col('late', 'Đi muộn', 'number'), col('absent', 'Vắng', 'number'), col('excused', 'Có phép', 'number'), col('rate', 'Tỷ lệ chuyên cần (%)', 'percent')],
            rows,
            summary: [
              { label: 'Lượt điểm danh', value: all.total },
              { label: 'Tỷ lệ chuyên cần', value: `${all.rate}%` },
              { label: 'Vắng không phép', value: all.absent },
            ],
          };
        }
        const rows = await Promise.all(
          classes.map(async (c) => {
            const gb = await this.grades.gradebook(p, c.id);
            return { code: c.code, name: c.name, course: c.course.name, teacher: c.teacher?.fullName ?? null, status: c.status, startDate: dateToYmd(c.startDate), endDate: dateToYmd(c.endDate), capacity: c.capacity, enrolled: c._count.enrollments, fillRate: pct((c._count.enrollments / c.capacity) * 100), attendanceRate: countAttendance((attBy.get(c.id) ?? []).map((a) => a.status)).rate, classAverage: gb.stats.classAverage };
          }),
        );
        return {
          ...base,
          title: 'Báo cáo lớp học',
          columns: [col('code', 'Mã lớp'), col('name', 'Lớp'), col('course', 'Khóa học'), col('teacher', 'Giáo viên'), col('status', 'Trạng thái'), col('startDate', 'Bắt đầu', 'date'), col('endDate', 'Kết thúc', 'date'), col('capacity', 'Sức chứa', 'number'), col('enrolled', 'Đã đăng ký', 'number'), col('fillRate', 'Lấp đầy (%)', 'percent'), col('attendanceRate', 'Chuyên cần (%)', 'percent'), col('classAverage', 'Điểm TB', 'number')],
          rows,
          summary: [
            { label: 'Số lớp trong kỳ', value: classes.length },
            { label: 'Đang hoạt động', value: classes.filter((c) => c.status === 'ACTIVE').length },
            { label: 'Tổng chỗ / đã đăng ký', value: `${classes.reduce((s, c) => s + c.capacity, 0)} / ${classes.reduce((s, c) => s + c._count.enrollments, 0)}` },
          ],
        };
      }
      case 'grades': {
        const classes = await this.prisma.classroom.findMany({ where: { tenantId: t, assessments: { some: { heldOn: { gte: ymdToDate(from), lte: ymdToDate(to) } } } }, orderBy: { code: 'asc' }, select: { id: true } });
        const books = await Promise.all(classes.map((c) => this.grades.gradebook(p, c.id)));
        const bands = books[0]?.bands ?? (await this.grades.bands(t));
        const rows = books.map((b) => ({ code: b.classroom.code, name: b.classroom.name, students: b.stats.students, graded: b.stats.graded, classAverage: b.stats.classAverage, highest: b.stats.highest, lowest: b.stats.lowest, passRate: b.stats.passRate, ...Object.fromEntries(b.stats.distribution.map((d) => [`band_${d.label}`, d.count])) }));
        const allAvgs = books.flatMap((b) => b.rows.map((r) => r.average).filter((x): x is number => x !== null));
        const overall = weightedAverage(allAvgs.map((a) => ({ score: a, maxScore: 10, weight: 1 })));
        return {
          ...base,
          title: 'Báo cáo kết quả học tập',
          columns: [col('code', 'Mã lớp'), col('name', 'Lớp'), col('students', 'Học viên', 'number'), col('graded', 'Có điểm', 'number'), col('classAverage', 'Điểm TB', 'number'), col('highest', 'Cao nhất', 'number'), col('lowest', 'Thấp nhất', 'number'), col('passRate', 'Đạt ≥ 5 (%)', 'percent'), ...bands.map((b) => col(`band_${b.label}`, b.label, 'number'))],
          rows,
          summary: [
            { label: 'Số lớp', value: books.length },
            { label: 'Điểm TB toàn trung tâm', value: overall ?? '—' },
            { label: 'Xếp loại TB', value: classify(overall, bands) ?? '—' },
          ],
        };
      }
      case 'revenue': {
        const payments = await this.prisma.payment.findMany({ where: { tenantId: t, paidAt: { gte: range.start, lt: range.end } }, orderBy: { paidAt: 'asc' }, include: { invoice: { select: { code: true, description: true, student: { select: { code: true, fullName: true } } } } } });
        const total = payments.reduce((s, x) => s + x.amountVnd, 0n);
        const byMethod = group(payments, (x) => x.method);
        return {
          ...base,
          title: 'Báo cáo doanh thu',
          columns: [col('paidAt', 'Ngày thu', 'date'), col('invoice', 'Mã khoản thu'), col('student', 'Học viên'), col('description', 'Nội dung'), col('method', 'Hình thức'), col('amountVnd', 'Số tiền (VND)', 'money'), col('receivedBy', 'Người thu')],
          rows: payments.map((x) => ({ paidAt: localYmd(x.paidAt), invoice: x.invoice.code, student: `${x.invoice.student.code} – ${x.invoice.student.fullName}`, description: x.invoice.description, method: x.method, amountVnd: money(x.amountVnd), receivedBy: x.receivedBy })),
          summary: [
            { label: 'Tổng doanh thu', value: `${total.toLocaleString('vi-VN')} ₫` },
            { label: 'Số giao dịch', value: payments.length },
            ...[...byMethod].map(([m, list]) => ({ label: m, value: `${list.reduce((s, x) => s + x.amountVnd, 0n).toLocaleString('vi-VN')} ₫` })),
          ],
        };
      }
      case 'debts': {
        const today = localYmd();
        const invoices = await this.prisma.invoice.findMany({ where: { tenantId: t, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lte: ymdToDate(to) } }, orderBy: { dueDate: 'asc' }, include: { student: { select: { code: true, fullName: true, phone: true } }, classroom: { select: { code: true } } } });
        const rows = invoices.map((i) => {
          const remaining = i.amountVnd - i.discountVnd - i.paidVnd;
          const due = dateToYmd(i.dueDate);
          const overdueDays = due < today ? Math.round((ymdToDate(today).getTime() - i.dueDate.getTime()) / 86_400_000) : 0;
          return { code: i.code, student: `${i.student.code} – ${i.student.fullName}`, phone: i.student.phone, classroom: i.classroom?.code ?? null, dueDate: due, totalDueVnd: money(i.amountVnd - i.discountVnd), paidVnd: money(i.paidVnd), remainingVnd: money(remaining), overdueDays, status: i.status };
        });
        const total = invoices.reduce((s, i) => s + i.amountVnd - i.discountVnd - i.paidVnd, 0n);
        return {
          ...base,
          title: 'Báo cáo học phí còn nợ',
          columns: [col('code', 'Mã khoản thu'), col('student', 'Học viên'), col('phone', 'Điện thoại'), col('classroom', 'Lớp'), col('dueDate', 'Hạn nộp', 'date'), col('totalDueVnd', 'Phải thu (VND)', 'money'), col('paidVnd', 'Đã thu (VND)', 'money'), col('remainingVnd', 'Còn nợ (VND)', 'money'), col('overdueDays', 'Số ngày quá hạn', 'number'), col('status', 'Trạng thái')],
          rows,
          summary: [
            { label: 'Tổng công nợ', value: `${total.toLocaleString('vi-VN')} ₫` },
            { label: 'Số khoản', value: invoices.length },
            { label: 'Quá hạn', value: rows.filter((r) => r.overdueDays > 0).length },
          ],
        };
      }
    }
  }
}

function col(key: string, label: string, type: Column['type'] = 'text'): Column {
  return { key, label, type };
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  }
  return m;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  @Roles('ADMIN')
  async get(@CurrentPrincipal() p: Principal, @Param('kind') kind: string, @Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) throw badRequest(`Loại báo cáo không hợp lệ: chọn một trong ${REPORT_KINDS.join(', ')}`, 'kind');
    const report = await this.reports.build(p, kind as ReportKind, q.from, q.to);
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="educenter-${kind}-${report.from}_${report.to}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return toCsv(report);
    }
    return report;
  }
}

@Module({ imports: [GradesModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
