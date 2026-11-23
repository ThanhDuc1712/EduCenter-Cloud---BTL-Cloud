import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/common/prisma/prisma.service';

describe('Health + database role (integration, requires PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

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

  it('GET /api/v1/health → 200 with database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { app: 'up', database: 'up' } });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health/live → 200', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok', checks: { app: 'up' } });
  });

  it('connects as edu_runtime: not superuser, no BYPASSRLS (INV-09/INV-10)', async () => {
    const [row] = await prisma.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ current_user: 'edu_runtime', rolsuper: false, rolbypassrls: false });
  });

  it('runtime role cannot run DDL', async () => {
    await expect(prisma.$executeRaw`CREATE TABLE should_not_exist (id int)`).rejects.toThrow();
  });
});
