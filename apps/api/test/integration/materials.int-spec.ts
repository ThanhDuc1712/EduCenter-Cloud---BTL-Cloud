import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/bootstrap/configure-app';
import { AppConfigService } from '../../src/common/config/app-config.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { parseHmacKeys, signCallback } from '../../src/modules/materials/hmac';
import { RESULT_SCHEMA } from '../../src/modules/materials/processing-result';
import { LocalProcessingDispatcher } from '../../src/modules/materials/processing.dispatchers';
import { parseQuarantineKey, storageKeys } from '../../src/modules/storage/storage.types';

/**
 * Cross-cloud contract against the real PostgreSQL (seeded demo data): object keys, signed callback,
 * retry to a new attempt key. The callbacks here are built the way Function Compute builds them.
 */
describe('Material pipeline contract (integration, requires PostgreSQL + seed)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let worker: LocalProcessingDispatcher;
  let keys: Map<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    keys = parseHmacKeys(app.get(AppConfigService).get('CALLBACK_HMAC_KEYS'));
    worker = app.get(LocalProcessingDispatcher);
    // The app does not listen on a port in tests: deliver the local worker's callbacks in-process.
    worker.sender = async (raw, headers) => {
      const res = await request(app.getHttpServer()).post('/api/v1/internal/material-callback').set(headers).set('content-type', 'application/json').send(raw.toString('utf8'));
      return { status: res.status };
    };
  });

  afterAll(async () => {
    await worker?.idle();
    await app?.close();
  });

  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  async function createMaterial() {
    const admin = request.agent(app.getHttpServer());
    await admin.put('/api/v1/context').send({ personaKey: 'admin' }).expect(200);
    const course = await prisma.course.findFirstOrThrow({ where: { tenant: { slug: 'hanoi-center' }, status: 'ACTIVE' } });
    const created = await admin.post('/api/v1/materials').send({ title: `Hợp đồng ${randomUUID().slice(0, 8)}`, category: 'LECTURE', visibility: 'COURSE', courseId: course.id, filename: 'a.pdf', contentType: 'application/pdf', size: PDF.length }).expect(201);
    const row = await prisma.material.findUniqueOrThrow({ where: { id: created.body.material.id } });
    return { admin, row, upload: created.body.upload as { url: string; fields: Record<string, string> } };
  }

  const row = (id: string) => prisma.material.findUniqueOrThrow({ where: { id } });

  function readyResult(m: { id: string; tenantId: string; quarantineKey: string }, versionId: string) {
    const { attempt } = parseQuarantineKey(m.quarantineKey)!;
    const out = [m.tenantId, m.id, attempt, versionId] as const;
    return {
      schema: RESULT_SCHEMA, eventId: `fc:${randomUUID()}`, tenantId: m.tenantId, materialId: m.id, sourceKey: m.quarantineKey, sourceVersionId: versionId,
      status: 'READY', processor: 'ALIYUN_FC', attempt, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 5,
      result: { sizeBytes: PDF.length, sha256: 'a'.repeat(64), pageCount: 1, title: null, author: null, documentKey: storageKeys.document(...out), previewKey: storageKeys.preview(...out, 'png'), previewContentType: 'image/png' },
      error: null,
    };
  }

  function callback(body: object, secret = keys.get('k1')!) {
    const raw = Buffer.from(JSON.stringify(body));
    return request(app.getHttpServer()).post('/api/v1/internal/material-callback').set(signCallback('k1', secret, raw)).set('content-type', 'application/json').send(raw.toString('utf8'));
  }

  it('create → ROADMAP quarantine key → signed callback updates exactly that material', async () => {
    const { row: m } = await createMaterial();
    const { row: other } = await createMaterial();
    expect(parseQuarantineKey(m.quarantineKey)).toEqual({ tenantId: m.tenantId, materialId: m.id, attempt: 1 });

    const good = readyResult(m, 'CAEQ.v1+x');
    await callback(good, 'x'.repeat(40)).expect(401);
    const wrongOutput = await callback({ ...good, eventId: `fc:${randomUUID()}`, result: { ...good.result, documentKey: readyResult(other, 'v1').result.documentKey } }).expect(200);
    expect(wrongOutput.body.applied).toBe(false);
    expect((await row(m.id)).status).toBe('UPLOADING');

    expect((await callback(good).expect(200)).body.applied).toBe(true);
    const done = await row(m.id);
    expect(done.status).toBe('READY');
    expect(done.publishedKey).toBe(`published/${m.tenantId}/${m.id}/1/CAEQ_v1_x.pdf`);
    expect(done.previewKey).toBe(`previews/${m.tenantId}/${m.id}/1/CAEQ_v1_x.png`);
    expect(done.resultKey).toBe(`results/${m.tenantId}/${m.id}/1/CAEQ_v1_x.json`);
    expect((await row(other.id)).status).toBe('UPLOADING');
    expect((await callback(good).expect(200)).body.duplicate).toBe(true);
  });

  it('retry copies the upload to a new attempt key; a late result of the old attempt is ignored', async () => {
    const { admin, row: m, upload } = await createMaterial();
    await request(app.getHttpServer()).post(upload.url).field('token', upload.fields.token).attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(204);
    const failed = { ...readyResult(m, 'v1'), status: 'FAILED', result: null, error: { code: 'SOURCE_MISSING', message: 'x' } };
    await callback(failed).expect(200);
    expect((await row(m.id)).status).toBe('FAILED');

    await admin.post(`/api/v1/materials/${m.id}/retry`).expect(201);
    const retried = await row(m.id);
    expect(retried.quarantineKey).not.toBe(m.quarantineKey);
    expect(parseQuarantineKey(retried.quarantineKey)?.attempt).toBe(2);

    const late = await callback(readyResult(m, 'v-old')).expect(200);
    expect(late.body.applied).toBe(false);

    await worker.idle();
    const done = await row(m.id);
    expect(done.status).toBe('READY');
    expect(done.publishedKey?.startsWith(`published/${m.tenantId}/${m.id}/2/`)).toBe(true);

    await admin.delete(`/api/v1/materials/${m.id}`).expect(200);
    expect((await row(m.id)).status).toBe('DELETED');
  });
});
