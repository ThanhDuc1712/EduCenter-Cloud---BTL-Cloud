import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/common/prisma/prisma.service';

/**
 * Business invariants against the real PostgreSQL (seeded demo data, `pnpm db:seed`).
 * Runs as edu_runtime. Each test creates its own uniquely-coded rows.
 */
describe('Business invariants (integration, requires PostgreSQL + seed)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const run = Date.now().toString(36).toUpperCase().slice(-5);

  const agent = () => request.agent(app.getHttpServer());
  async function as(persona: string) {
    const a = agent();
    await a.put('/api/v1/context').send({ personaKey: persona }).expect(200);
    return a;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tenant isolation: a row from another tenant is not reachable (404), composite FK blocks cross-tenant links', async () => {
    const other = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'saigon-center' } });
    const foreign = await prisma.student.findFirstOrThrow({ where: { tenantId: other.id } });
    const admin = await as('admin');
    await admin.get(`/api/v1/students/${foreign.id}`).expect(404);
    const list = await admin.get(`/api/v1/students?q=${encodeURIComponent(foreign.code)}&pageSize=100`).expect(200);
    expect(list.body.items.every((s: { id: string }) => s.id !== foreign.id)).toBe(true);

    // DB level: an enrollment pointing at a class of tenant A and a student of tenant B is impossible.
    const home = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'hanoi-center' } });
    const cls = await prisma.classroom.findFirstOrThrow({ where: { tenantId: home.id } });
    await expect(prisma.enrollment.create({ data: { tenantId: home.id, classroomId: cls.id, studentId: foreign.id } })).rejects.toThrow();
  });

  it('client-supplied tenant / role fields are rejected, not honoured', async () => {
    const admin = await as('admin');
    const res = await admin.post('/api/v1/students').send({ fullName: 'Spoof', tenantId: '00000000-0000-4000-8000-000000000000', role: 'ADMIN' }).expect(400);
    expect(res.body.fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual(['role', 'tenantId']);
  });

  it('role scope: a teacher only sees students of their own classes; a student cannot read tuition of others', async () => {
    const teacher = await as('teacher:GV001');
    const t = await prisma.teacher.findFirstOrThrow({ where: { code: 'GV001', tenant: { slug: 'hanoi-center' } } });
    const res = await teacher.get('/api/v1/students?pageSize=100').expect(200);
    const ids: string[] = res.body.items.map((s: { id: string }) => s.id);
    const allowed = await prisma.enrollment.findMany({ where: { classroom: { teacherId: t.id } }, select: { studentId: true } });
    expect(ids.every((id) => allowed.some((a) => a.studentId === id))).toBe(true);
    await teacher.get('/api/v1/invoices').expect(403);

    const student = await as('student:HV0001');
    const me = await prisma.student.findFirstOrThrow({ where: { code: 'HV0001', tenant: { slug: 'hanoi-center' } } });
    const invoices = await student.get('/api/v1/invoices?pageSize=100').expect(200);
    expect(invoices.body.items.every((i: { student: { id: string } }) => i.student.id === me.id)).toBe(true);
    const otherInvoice = await prisma.invoice.findFirstOrThrow({ where: { tenant: { slug: 'hanoi-center' }, studentId: { not: me.id } } });
    await student.get(`/api/v1/invoices/${otherInvoice.id}`).expect(404);
  });

  it('payments are idempotent (same key + body → same payment; same key + other body → 409) and cannot exceed the balance', async () => {
    const admin = await as('admin');
    const s = await admin.post('/api/v1/students').send({ fullName: `Thanh toán ${run}` }).expect(201);
    const inv = await admin.post('/api/v1/invoices').send({ studentId: s.body.id, description: 'Kiểm thử', amountVnd: '1000000', dueDate: '2030-01-01' }).expect(201);
    const key = `it-${run}-pay-0001`;
    const first = await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).set('Idempotency-Key', key).send({ amountVnd: '400000', method: 'CASH' }).expect(201);
    const replay = await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).set('Idempotency-Key', key).send({ amountVnd: '400000', method: 'CASH' }).expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.invoice.paidVnd).toBe('400000');
    await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).set('Idempotency-Key', key).send({ amountVnd: '500000', method: 'CASH' }).expect(409);
    await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).send({ amountVnd: '1000', method: 'CASH' }).expect(400);
    const over = await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).set('Idempotency-Key', `it-${run}-pay-0002`).send({ amountVnd: '700000', method: 'CASH' }).expect(422);
    expect(over.body.code).toBe('PAYMENT_EXCEEDS_BALANCE');
    const full = await admin.post(`/api/v1/invoices/${inv.body.id}/payments`).set('Idempotency-Key', `it-${run}-pay-0003`).send({ amountVnd: '600000', method: 'BANK_TRANSFER' }).expect(201);
    expect(full.body.invoice.status).toBe('PAID');
  });

  it('class capacity holds under concurrent enrollments (row lock)', async () => {
    const admin = await as('admin');
    const course = await prisma.course.findFirstOrThrow({ where: { tenant: { slug: 'hanoi-center' }, code: 'ENG-COM' } });
    const cls = await admin.post('/api/v1/classrooms').send({ code: `CAP-${run}`, name: 'Sức chứa', courseId: course.id, capacity: 2, startDate: '2030-01-01', endDate: '2030-02-01' }).expect(201);
    const students = await Promise.all([1, 2, 3, 4, 5].map((i) => admin.post('/api/v1/students').send({ fullName: `Sức chứa ${run} ${i}` }).expect(201)));
    const results = await Promise.all(students.map((s) => agent().post('/api/v1/enrollments').set('cookie', '').send({ classroomId: cls.body.id, studentId: s.body.id, createInvoice: false })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'CLASSROOM_FULL')).toBe(true);
    expect(await prisma.enrollment.count({ where: { classroomId: cls.body.id, status: 'ACTIVE' } })).toBe(2);
  });

  it('grades use optimistic locking (stale version → 409) and enforce the score range', async () => {
    const teacherRow = await prisma.teacher.findFirstOrThrow({ where: { code: 'GV001', tenant: { slug: 'hanoi-center' } } });
    const cls = await prisma.classroom.findFirstOrThrow({ where: { teacherId: teacherRow.id, status: 'ACTIVE' }, include: { enrollments: { where: { status: 'ACTIVE' }, take: 1 } } });
    const teacher = await as('teacher:GV001');
    const a = await teacher.post(`/api/v1/classrooms/${cls.id}/assessments`).send({ name: `Bài ${run}`, type: 'OTHER', weight: 0 }).expect(201);
    const studentId = cls.enrollments[0].studentId;
    await teacher.put(`/api/v1/assessments/${a.body.id}/grades`).send({ grades: [{ studentId, score: 7.5, version: 0 }] }).expect(200);
    await teacher.put(`/api/v1/assessments/${a.body.id}/grades`).send({ grades: [{ studentId, score: 8, version: 1 }] }).expect(200);
    const stale = await teacher.put(`/api/v1/assessments/${a.body.id}/grades`).send({ grades: [{ studentId, score: 9, version: 1 }] }).expect(409);
    expect(stale.body.code).toBe('GRADE_VERSION_CONFLICT');
    await teacher.put(`/api/v1/assessments/${a.body.id}/grades`).send({ grades: [{ studentId, score: 11 }] }).expect(400);
    // Another teacher cannot grade this class.
    const other = await as('teacher:GV002');
    await other.put(`/api/v1/assessments/${a.body.id}/grades`).send({ grades: [{ studentId, score: 5 }] }).expect(403);
    await teacher.delete(`/api/v1/assessments/${a.body.id}`).expect(200);
  });

  it('runtime role cannot rewrite the audit trail (activity_logs is append-only)', async () => {
    await expect(prisma.$executeRaw`UPDATE activity_logs SET summary = 'tampered' WHERE id IN (SELECT id FROM activity_logs LIMIT 1)`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM payments WHERE id IN (SELECT id FROM payments LIMIT 1)`).rejects.toThrow();
  });
});
