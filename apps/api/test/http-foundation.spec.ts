import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PublicPolicy } from '../src/common/authz/policy.decorator';
import { configureApp } from '../src/common/bootstrap/configure-app';
import { CommonModule } from '../src/common/common.module';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class CreateThingDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(20)
  name: string;
}

@Controller('probe')
class ProbeController {
  @Post('things')
  @PublicPolicy()
  create(@Body() dto: CreateThingDto) {
    return { ok: true, isDto: dto instanceof CreateThingDto };
  }

  @Get('boom')
  @PublicPolicy()
  boom(): never {
    throw new Error('db password=hunter2 at /srv/app/secret.ts:42');
  }

  @Get('slow')
  @PublicPolicy()
  async slow() {
    await new Promise((r) => setTimeout(r, 400));
    return { done: true };
  }

  /** No policy declared → must be denied (INV-02). */
  @Get('undeclared')
  undeclared() {
    return { leaked: true };
  }
}

@Controller('internal')
class InternalProbeController {
  @Post('echo')
  @PublicPolicy() // test-only; real internal routes use @InternalHmacPolicy (P1-03)
  echo(@Req() req: Request) {
    return { isBuffer: Buffer.isBuffer(req.body), length: (req.body as Buffer).length };
  }
}

@Module({ imports: [CommonModule], controllers: [ProbeController, InternalProbeController] })
class ProbeModule {}

async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('HTTP foundation (no database)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns a server-generated X-Request-ID and ignores the client value', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/things')
      .set('X-Request-ID', 'client-chosen-id')
      .send({ email: 'a@example.test', name: 'x' })
      .expect(201);
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body).toEqual({ ok: true, isDto: true });
  });

  it('rejects unknown DTO fields with 400 VALIDATION_FAILED and fieldErrors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/things')
      .send({ email: 'a@example.test', name: 'x', tenantId: 'evil', role: 'ADMIN' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual(['role', 'tenantId']);
  });

  it('rejects malformed JSON with 400 and no parser internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/things')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.body).toEqual({ code: 'VALIDATION_FAILED', message: 'Malformed JSON body', requestId: expect.stringMatching(UUID) });
  });

  it('rejects oversized JSON bodies with 413 in the standard error shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/things')
      .send({ email: 'a@example.test', name: 'x'.repeat(5000) })
      .expect(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.requestId).toMatch(UUID);
  });

  it('denies routes without a declared policy (deny-by-default)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/undeclared').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain('leaked');
  });

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/boom').expect(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: expect.stringMatching(UUID) });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|secret\.ts|stack/);
  });

  it('returns the standard 404 body for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Resource not found', requestId: expect.stringMatching(UUID) });
  });

  it('gives /internal/* routes the raw body as a Buffer (for HMAC) and normal routes JSON', async () => {
    const payload = '{"eventId":"e-1","b":2}';
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/echo')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);
    expect(res.body).toEqual({ isBuffer: true, length: Buffer.byteLength(payload) });
  });

  it('sets security headers and does not enable CORS or x-powered-by', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/slow')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Graceful shutdown', () => {
  it('lets an in-flight request finish when the app closes', async () => {
    const app = await createApp();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;

    const inFlight = fetch(`http://127.0.0.1:${port}/api/v1/probe/slow`);
    await new Promise((r) => setTimeout(r, 100)); // request is now being handled
    const closing = app.close();

    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    await closing;

    await expect(fetch(`http://127.0.0.1:${port}/api/v1/probe/slow`)).rejects.toThrow();
  });
});
