import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/common/prisma/prisma.service';

/**
 * Login / registration against the real PostgreSQL (requires `pnpm db:migrate` + `pnpm db:seed`).
 * Every account created here is removed again in afterAll.
 */
describe('Auth: register / login / logout (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const run = Date.now().toString(36);
  const email = `it.${run}@example.test`;
  const password = 'Matkhau123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({ where: { email }, select: { id: true, studentId: true } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
      await prisma.student.deleteMany({ where: { id: { in: users.map((u) => u.studentId).filter((x): x is string => !!x) } } });
      await prisma.loginAttempt.deleteMany({ where: { OR: [{ key: 'register' }, { key: { contains: email } }] } });
    }
    await app?.close();
  });

  it('registers a STUDENT account with a new profile and signs it in', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/register').send({ tenantSlug: 'hanoi-center', fullName: 'Học viên Kiểm thử', email: email.toUpperCase(), password }).expect(201);
    expect(res.body.principal).toMatchObject({ role: 'STUDENT', authMethod: 'session', email, tenantSlug: 'hanoi-center' });
    expect(String(res.headers['set-cookie'])).toMatch(/educenter_session=.+HttpOnly/i);

    const ctx = await agent.get('/api/v1/context').expect(200);
    expect(ctx.body.principal.userId).toBe(res.body.principal.userId);

    const stored = await prisma.user.findFirstOrThrow({ where: { email, tenant: { slug: 'hanoi-center' } } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(password);
    expect(await prisma.authSession.count({ where: { userId: stored.id } })).toBe(1);
  });

  it('rejects a second registration with the same email in the same center (409)', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ tenantSlug: 'hanoi-center', fullName: 'Trùng', email, password }).expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('cannot self-register a role or attach to an existing profile', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ tenantSlug: 'hanoi-center', fullName: 'Giả mạo', email: `x.${email}`, password, role: 'ADMIN', studentId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    expect(res.body.fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual(['role', 'studentId']);
  });

  it('returns the same 401 for wrong password, unknown email and wrong center', async () => {
    const server = app.getHttpServer();
    const bodies = [
      { tenantSlug: 'hanoi-center', email, password: 'Sai12345' },
      { tenantSlug: 'hanoi-center', email: `nobody.${email}`, password },
      { tenantSlug: 'saigon-center', email, password },
    ];
    for (const body of bodies) {
      const res = await request(server).post('/api/v1/auth/login').send(body).expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('logs in, rotates the session, and logout revokes it server-side', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/v1/auth/login').send({ tenantSlug: 'hanoi-center', email, password }).expect(200);
    expect(login.body.principal).toMatchObject({ role: 'STUDENT', authMethod: 'session' });
    const cookie = String(login.headers['set-cookie']).split(';')[0];

    await agent.post('/api/v1/auth/logout').expect(204);
    // The old token no longer authenticates (the suite runs in AUTH_MODE=demo, so it falls back to demo).
    const after = await request(app.getHttpServer()).get('/api/v1/context').set('Cookie', cookie).expect(200);
    expect(after.body.principal.authMethod).toBe('demo');
  });

  it('rejects a cross-origin login (login CSRF)', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({ tenantSlug: 'hanoi-center', email, password }).expect(403);
  });

  it('changes the password and revokes the other sessions', async () => {
    const a = request.agent(app.getHttpServer());
    const b = request.agent(app.getHttpServer());
    await a.post('/api/v1/auth/login').send({ tenantSlug: 'hanoi-center', email, password }).expect(200);
    await b.post('/api/v1/auth/login').send({ tenantSlug: 'hanoi-center', email, password }).expect(200);
    await a.post('/api/v1/auth/change-password').send({ currentPassword: password, newPassword: 'Matkhau456' }).expect(204);

    expect((await a.get('/api/v1/context').expect(200)).body.principal.authMethod).toBe('session');
    expect((await b.get('/api/v1/context').expect(200)).body.principal.authMethod).toBe('demo');
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantSlug: 'hanoi-center', email, password }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantSlug: 'hanoi-center', email, password: 'Matkhau456' }).expect(200);
  });
});
