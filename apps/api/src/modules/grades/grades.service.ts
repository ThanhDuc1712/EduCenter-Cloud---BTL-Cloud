import { Injectable } from '@nestjs/common';
import type { AssessmentType } from '../../generated/prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { assertCanManageClass, badRequest, classroomScope, conflict, notFound, studentScope, unprocessable } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTx } from '../../common/prisma/tenant-tx';
import { dateToYmd, ymdToDate } from '../../common/time';

export interface AssessmentInput {
  name: string;
  type: AssessmentType;
  weight: number;
  maxScore?: number;
  heldOn?: string;
}

export interface GradeInput {
  studentId: string;
  /** null removes the grade. */
  score: number | null;
  comment?: string;
  /** Version the client last saw; mismatch → 409 (optimistic locking). */
  version?: number;
}

export interface Band {
  label: string;
  minScore: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weighted average on the 10-point scale over the assessments that have a score. */
export function weightedAverage(items: { score: number; maxScore: number; weight: number }[]): number | null {
  const graded = items.filter((i) => i.weight > 0);
  const totalWeight = graded.reduce((s, i) => s + i.weight, 0);
  if (totalWeight === 0) {
    if (items.length === 0) return null;
    return round2(items.reduce((s, i) => s + (i.score / i.maxScore) * 10, 0) / items.length);
  }
  return round2(graded.reduce((s, i) => s + (i.score / i.maxScore) * 10 * i.weight, 0) / totalWeight);
}

export function classify(avg: number | null, bands: Band[]): string | null {
  if (avg === null) return null;
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  return sorted.find((b) => avg >= b.minScore)?.label ?? null;
}

@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TenantTx,
    private readonly activity: ActivityService,
  ) {}

  async bands(tenantId: string): Promise<Band[]> {
    const rows = await this.prisma.gradeBand.findMany({ where: { tenantId }, orderBy: { minScore: 'desc' } });
    return rows.map((b) => ({ label: b.label, minScore: Number(b.minScore) }));
  }

  async replaceBands(p: Principal, bands: Band[]) {
    const labels = bands.map((b) => b.label.trim());
    if (new Set(labels).size !== labels.length) throw badRequest('Tên xếp loại bị trùng', 'bands');
    if (!bands.some((b) => b.minScore === 0)) throw badRequest('Phải có một mức xếp loại bắt đầu từ 0 điểm', 'bands');
    return this.tx.run(p, async (db) => {
      await db.gradeBand.deleteMany({ where: { tenantId: p.tenantId } });
      await db.gradeBand.createMany({ data: bands.map((b) => ({ tenantId: p.tenantId, label: b.label.trim(), minScore: b.minScore.toFixed(2) })) });
      await this.activity.record(db, p, { action: 'grade_bands.updated', entityType: 'grade_band', summary: `Cập nhật thang xếp loại: ${bands.map((b) => `${b.label} ≥ ${b.minScore}`).join(', ')}` });
      return bands.sort((a, b) => b.minScore - a.minScore);
    });
  }

  private async classForManage(p: Principal, classroomId: string) {
    const c = await this.prisma.classroom.findFirst({ where: { tenantId: p.tenantId, id: classroomId } });
    if (!c) throw notFound('lớp học');
    assertCanManageClass(p, c);
    return c;
  }

  async listAssessments(p: Principal, classroomId: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id: classroomId }] }, select: { id: true } });
    if (!c) throw notFound('lớp học');
    const rows = await this.prisma.assessment.findMany({ where: { tenantId: p.tenantId, classroomId }, orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }], include: { _count: { select: { grades: true } } } });
    return rows.map((a) => ({ id: a.id, name: a.name, type: a.type, weight: a.weight, maxScore: Number(a.maxScore), heldOn: a.heldOn ? dateToYmd(a.heldOn) : null, gradedCount: a._count.grades }));
  }

  async createAssessment(p: Principal, classroomId: string, dto: AssessmentInput) {
    const c = await this.classForManage(p, classroomId);
    return this.tx.run(p, async (db) => {
      const sum = await db.assessment.aggregate({ where: { tenantId: p.tenantId, classroomId }, _sum: { weight: true } });
      if ((sum._sum.weight ?? 0) + dto.weight > 100) throw unprocessable('WEIGHT_EXCEEDED', `Tổng trọng số vượt 100% (hiện tại ${sum._sum.weight ?? 0}%)`);
      const a = await db.assessment.create({ data: { tenantId: p.tenantId, classroomId, name: dto.name, type: dto.type, weight: dto.weight, maxScore: (dto.maxScore ?? 10).toFixed(2), heldOn: dto.heldOn ? ymdToDate(dto.heldOn) : null } });
      await this.activity.record(db, p, { action: 'assessment.created', entityType: 'assessment', entityId: a.id, summary: `Tạo bài kiểm tra "${a.name}" (${a.weight}%) lớp ${c.code}` });
      return { id: a.id, name: a.name, type: a.type, weight: a.weight, maxScore: Number(a.maxScore), heldOn: dto.heldOn ?? null, gradedCount: 0 };
    });
  }

  async updateAssessment(p: Principal, id: string, dto: Partial<AssessmentInput>) {
    return this.tx.run(p, async (db) => {
      const a = await db.assessment.findFirst({ where: { tenantId: p.tenantId, id }, include: { classroom: true } });
      if (!a) throw notFound('bài kiểm tra');
      assertCanManageClass(p, a.classroom);
      if (dto.weight !== undefined) {
        const sum = await db.assessment.aggregate({ where: { tenantId: p.tenantId, classroomId: a.classroomId, id: { not: id } }, _sum: { weight: true } });
        if ((sum._sum.weight ?? 0) + dto.weight > 100) throw unprocessable('WEIGHT_EXCEEDED', 'Tổng trọng số vượt 100%');
      }
      if (dto.maxScore !== undefined) {
        const max = await db.grade.aggregate({ where: { tenantId: p.tenantId, assessmentId: id }, _max: { score: true } });
        if (max._max.score && Number(max._max.score) > dto.maxScore) throw unprocessable('MAX_SCORE_TOO_LOW', 'Đã có điểm lớn hơn thang điểm mới');
      }
      const u = await db.assessment.update({ where: { id }, data: { name: dto.name, type: dto.type, weight: dto.weight, maxScore: dto.maxScore?.toFixed(2), heldOn: dto.heldOn ? ymdToDate(dto.heldOn) : undefined } });
      await this.activity.record(db, p, { action: 'assessment.updated', entityType: 'assessment', entityId: id, summary: `Cập nhật bài kiểm tra "${u.name}" lớp ${a.classroom.code}` });
      return { id: u.id, name: u.name, type: u.type, weight: u.weight, maxScore: Number(u.maxScore), heldOn: u.heldOn ? dateToYmd(u.heldOn) : null };
    });
  }

  async deleteAssessment(p: Principal, id: string) {
    return this.tx.run(p, async (db) => {
      const a = await db.assessment.findFirst({ where: { tenantId: p.tenantId, id }, include: { classroom: true } });
      if (!a) throw notFound('bài kiểm tra');
      assertCanManageClass(p, a.classroom);
      await db.assessment.delete({ where: { id } });
      await this.activity.record(db, p, { action: 'assessment.deleted', entityType: 'assessment', entityId: id, summary: `Xóa bài kiểm tra "${a.name}" lớp ${a.classroom.code}` });
      return { deleted: true };
    });
  }

  /** Grade entry sheet of one assessment. */
  async assessmentGrades(p: Principal, id: string) {
    const a = await this.prisma.assessment.findFirst({ where: { tenantId: p.tenantId, id, classroom: classroomScope(p) }, include: { classroom: { select: { id: true, code: true, name: true, teacherId: true } } } });
    if (!a) throw notFound('bài kiểm tra');
    const [enrollments, grades] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { tenantId: p.tenantId, classroomId: a.classroomId, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) }, include: { student: { select: { id: true, code: true, fullName: true } } }, orderBy: { student: { fullName: 'asc' } } }),
      this.prisma.grade.findMany({ where: { tenantId: p.tenantId, assessmentId: id, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) } }),
    ]);
    const byStudent = new Map(grades.map((g) => [g.studentId, g]));
    return {
      assessment: { id: a.id, name: a.name, type: a.type, weight: a.weight, maxScore: Number(a.maxScore), heldOn: a.heldOn ? dateToYmd(a.heldOn) : null, classroom: { id: a.classroom.id, code: a.classroom.code, name: a.classroom.name } },
      canEdit: p.role === 'ADMIN' || (p.role === 'TEACHER' && a.classroom.teacherId === p.teacherId),
      rows: enrollments
        .filter((e) => e.status === 'ACTIVE' || e.status === 'COMPLETED' || byStudent.has(e.studentId))
        .map((e) => {
          const g = byStudent.get(e.studentId);
          return { student: e.student, enrollmentStatus: e.status, score: g ? Number(g.score) : null, comment: g?.comment ?? null, version: g?.version ?? 0, updatedAt: g?.updatedAt ?? null };
        }),
    };
  }

  async saveGrades(p: Principal, assessmentId: string, inputs: GradeInput[]) {
    const ids = inputs.map((g) => g.studentId);
    if (new Set(ids).size !== ids.length) throw badRequest('Danh sách điểm có học viên trùng lặp', 'grades');
    return this.tx.run(p, async (db) => {
      const a = await db.assessment.findFirst({ where: { tenantId: p.tenantId, id: assessmentId }, include: { classroom: true } });
      if (!a) throw notFound('bài kiểm tra');
      assertCanManageClass(p, a.classroom);
      const max = Number(a.maxScore);
      const enrolled = new Set((await db.enrollment.findMany({ where: { tenantId: p.tenantId, classroomId: a.classroomId, studentId: { in: ids } }, select: { studentId: true } })).map((e) => e.studentId));
      if (ids.some((id) => !enrolled.has(id))) throw unprocessable('STUDENT_NOT_IN_CLASS', 'Có học viên không thuộc lớp');

      let saved = 0;
      const notifyIds: string[] = [];
      for (const g of inputs) {
        if (g.score !== null && (g.score < 0 || g.score > max)) throw badRequest(`Điểm phải trong khoảng 0 – ${max}`, 'score');
        const current = await db.grade.findUnique({ where: { tenantId_assessmentId_studentId: { tenantId: p.tenantId, assessmentId, studentId: g.studentId } } });
        if (g.version !== undefined && (current?.version ?? 0) !== g.version) {
          throw conflict('GRADE_VERSION_CONFLICT', 'Điểm đã được người khác cập nhật. Hãy tải lại bảng điểm trước khi lưu.');
        }
        if (g.score === null) {
          if (current) await db.grade.delete({ where: { id: current.id } });
          continue;
        }
        const score = g.score.toFixed(2);
        if (current) {
          if (Number(current.score) === g.score && (current.comment ?? null) === (g.comment ?? null)) continue;
          // Version predicate in the WHERE makes the optimistic lock atomic.
          const res = await db.grade.updateMany({ where: { id: current.id, version: current.version }, data: { score, comment: g.comment ?? null, version: { increment: 1 } } });
          if (res.count === 0) throw conflict('GRADE_VERSION_CONFLICT', 'Điểm đã được người khác cập nhật. Hãy tải lại bảng điểm.');
        } else {
          await db.grade.create({ data: { tenantId: p.tenantId, assessmentId, studentId: g.studentId, score, comment: g.comment ?? null } });
        }
        saved += 1;
        notifyIds.push(g.studentId);
      }
      if (notifyIds.length) {
        await this.activity.notify(db, p.tenantId, { type: 'GRADE', title: `Kết quả "${a.name}" – lớp ${a.classroom.code}`, body: `Điểm bài "${a.name}" đã được cập nhật. Xem chi tiết tại trang Điểm số.`, link: '/grades' }, notifyIds.map((studentId) => ({ role: 'STUDENT', studentId })));
        await this.activity.record(db, p, { action: 'grades.saved', entityType: 'assessment', entityId: assessmentId, summary: `Nhập/cập nhật ${saved} điểm bài "${a.name}" lớp ${a.classroom.code}` });
      }
      return { saved };
    });
  }

  /** Students × assessments matrix with weighted average, band and class statistics. */
  async gradebook(p: Principal, classroomId: string) {
    const c = await this.prisma.classroom.findFirst({ where: { AND: [classroomScope(p), { id: classroomId }] }, select: { id: true, code: true, name: true, teacherId: true } });
    if (!c) throw notFound('lớp học');
    const studentFilter = p.role === 'STUDENT' ? { studentId: p.studentId } : {};
    const [assessments, enrollments, grades, bands] = await Promise.all([
      this.prisma.assessment.findMany({ where: { tenantId: p.tenantId, classroomId }, orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.enrollment.findMany({ where: { tenantId: p.tenantId, classroomId, status: { in: ['ACTIVE', 'COMPLETED'] }, ...studentFilter }, include: { student: { select: { id: true, code: true, fullName: true } } }, orderBy: { student: { fullName: 'asc' } } }),
      this.prisma.grade.findMany({ where: { tenantId: p.tenantId, assessment: { classroomId }, ...studentFilter } }),
      this.bands(p.tenantId),
    ]);
    const key = (s: string, a: string) => `${s}:${a}`;
    const gmap = new Map(grades.map((g) => [key(g.studentId, g.assessmentId), g]));
    const rows = enrollments.map((e) => {
      const scores = assessments.map((a) => {
        const g = gmap.get(key(e.studentId, a.id));
        return { assessmentId: a.id, score: g ? Number(g.score) : null };
      });
      const items = assessments.flatMap((a, i) => (scores[i].score === null ? [] : [{ score: scores[i].score!, maxScore: Number(a.maxScore), weight: a.weight }]));
      const average = weightedAverage(items);
      return { student: e.student, scores, average, band: classify(average, bands) };
    });
    const averages = rows.map((r) => r.average).filter((x): x is number => x !== null);
    const distribution = bands.map((b) => ({ label: b.label, count: rows.filter((r) => r.band === b.label).length }));
    return {
      classroom: { id: c.id, code: c.code, name: c.name },
      canEdit: p.role === 'ADMIN' || (p.role === 'TEACHER' && c.teacherId === p.teacherId),
      assessments: assessments.map((a) => ({ id: a.id, name: a.name, type: a.type, weight: a.weight, maxScore: Number(a.maxScore), heldOn: a.heldOn ? dateToYmd(a.heldOn) : null })),
      rows,
      bands,
      stats: {
        students: rows.length,
        graded: averages.length,
        classAverage: averages.length ? round2(averages.reduce((s, x) => s + x, 0) / averages.length) : null,
        highest: averages.length ? Math.max(...averages) : null,
        lowest: averages.length ? Math.min(...averages) : null,
        passRate: averages.length ? Math.round((averages.filter((a) => a >= 5).length / averages.length) * 1000) / 10 : null,
        distribution,
      },
    };
  }

  /** Grades of one student grouped by class (scoped). */
  async studentGrades(p: Principal, studentId: string) {
    const s = await this.prisma.student.findFirst({ where: { AND: [studentScope(p), { id: studentId }] }, select: { id: true } });
    if (!s) throw notFound('học viên');
    const classFilter = p.role === 'TEACHER' ? { teacherId: p.teacherId } : {};
    const [enrollments, grades, bands] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { tenantId: p.tenantId, studentId, classroom: classFilter }, include: { classroom: { select: { id: true, code: true, name: true, assessments: { orderBy: { heldOn: 'asc' } } } } } }),
      this.prisma.grade.findMany({ where: { tenantId: p.tenantId, studentId } }),
      this.bands(p.tenantId),
    ]);
    const gmap = new Map(grades.map((g) => [g.assessmentId, g]));
    const classes = enrollments.map((e) => {
      const assessments = e.classroom.assessments.map((a) => {
        const g = gmap.get(a.id);
        return { id: a.id, name: a.name, type: a.type, weight: a.weight, maxScore: Number(a.maxScore), heldOn: a.heldOn ? dateToYmd(a.heldOn) : null, score: g ? Number(g.score) : null, comment: g?.comment ?? null };
      });
      const average = weightedAverage(assessments.filter((a) => a.score !== null).map((a) => ({ score: a.score!, maxScore: a.maxScore, weight: a.weight })));
      return { classroom: { id: e.classroom.id, code: e.classroom.code, name: e.classroom.name }, enrollmentStatus: e.status, assessments, average, band: classify(average, bands) };
    });
    const avgs = classes.map((c) => c.average).filter((x): x is number => x !== null);
    return { overallAverage: avgs.length ? round2(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null, classes, bands };
  }
}
