import { computeSignature, parseHmacKeys, signCallback, verifyCallback } from './hmac';
import { canTransition, MATERIAL_TRANSITIONS } from './material-state';
import { inspectPdf } from './pdf-inspect';
import { parseProcessingResult, RESULT_SCHEMA } from './processing-result';
import { PDFDocument } from 'pdf-lib';
import { parseQuarantineKey, storageKeys } from '../storage/storage.types';
import { signToken, verifyToken } from '../storage/signed-token';

const KEYS = parseHmacKeys('k1:first-secret-value-0123456789abcdef,k2:second-secret-value-0123456789abcd');
const body = Buffer.from('{"eventId":"local:abc12345","x":1}');

describe('HMAC callback verification', () => {
  it('accepts a correctly signed body for either rotation key', () => {
    for (const keyId of ['k1', 'k2']) {
      const headers = signCallback(keyId, KEYS.get(keyId)!, body);
      expect(verifyCallback(KEYS, headers, body, 300)).toMatchObject({ ok: true, keyId });
    }
  });

  it('rejects a modified body (signature covers the raw bytes)', () => {
    const headers = signCallback('k1', KEYS.get('k1')!, body);
    expect(verifyCallback(KEYS, headers, Buffer.from('{"eventId":"local:abc12345","x":2}'), 300)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects unknown key IDs, missing headers and malformed signatures', () => {
    const headers = signCallback('k1', KEYS.get('k1')!, body);
    expect(verifyCallback(KEYS, { ...headers, 'x-edu-key-id': 'k9' }, body, 300)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    expect(verifyCallback(KEYS, {}, body, 300)).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
    expect(verifyCallback(KEYS, { ...headers, 'x-edu-signature': 'abc' }, body, 300)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects stale or future timestamps (replay window)', () => {
    const old = signCallback('k1', KEYS.get('k1')!, body, Date.now() - 10 * 60_000);
    expect(verifyCallback(KEYS, old, body, 300)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    const future = signCallback('k1', KEYS.get('k1')!, body, Date.now() + 10 * 60_000);
    expect(verifyCallback(KEYS, future, body, 300)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
  });

  it('a signature made with one key does not validate under another key ID', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { 'x-edu-key-id': 'k2', 'x-edu-timestamp': ts, 'x-edu-signature': `v1=${computeSignature(KEYS.get('k1')!, ts, body)}` };
    expect(verifyCallback(KEYS, headers, body, 300)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('matches the Python Function Compute signing (known vector)', () => {
    // Same vector is asserted in functions/material-processor/tests/test_callback.py.
    expect(computeSignature('test-secret-0123456789abcdef0123456789', '1700000000', Buffer.from('{"a":1}'))).toBe('773367e1dd7d86efbea93b835d6b00ebff0b7da38875d3672436868154633359');
  });
});

describe('Material state machine', () => {
  it('allows the pipeline transitions', () => {
    expect(canTransition('UPLOADING', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'READY')).toBe(true);
    expect(canTransition('PROCESSING', 'REJECTED')).toBe(true);
    expect(canTransition('FAILED', 'PROCESSING')).toBe(true);
    expect(canTransition('UPLOADING', 'READY')).toBe(true); // callback before "complete"
  });

  it('keeps READY / REJECTED final and DELETED terminal', () => {
    expect(canTransition('READY', 'PROCESSING')).toBe(false);
    expect(canTransition('REJECTED', 'READY')).toBe(false);
    for (const to of Object.keys(MATERIAL_TRANSITIONS)) expect(canTransition('DELETED', to as never)).toBe(false);
    for (const from of ['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED'] as const) expect(canTransition(from, 'DELETED')).toBe(true);
  });
});

describe('Processing result contract', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const materialId = '22222222-2222-4222-8222-222222222222';
  const valid = {
    schema: RESULT_SCHEMA,
    eventId: 'fc:req-123456',
    tenantId,
    materialId,
    sourceKey: storageKeys.quarantine(tenantId, materialId),
    sourceVersionId: 'v1',
    correlationId: 'mat-22222222-a1-abcdef',
    status: 'READY',
    processor: 'ALIYUN_FC',
    startedAt: '2026-11-24T10:00:00.000Z',
    finishedAt: '2026-11-24T10:00:01.000Z',
    durationMs: 1000,
    result: { sizeBytes: 100, sha256: 'a'.repeat(64), pageCount: 2, title: 't', author: null, documentKey: storageKeys.document(tenantId, materialId), previewKey: storageKeys.preview(tenantId, materialId, 'png'), previewContentType: 'image/png' },
    error: null,
  };

  it('accepts a valid READY payload', () => {
    expect(parseProcessingResult(valid).ok).toBe(true);
  });

  it('requires result for READY and error otherwise, and a known schema', () => {
    expect(parseProcessingResult({ ...valid, result: null }).ok).toBe(false);
    expect(parseProcessingResult({ ...valid, status: 'REJECTED' }).ok).toBe(false);
    expect(parseProcessingResult({ ...valid, status: 'REJECTED', result: null, error: { code: 'NOT_PDF', message: 'x' } }).ok).toBe(true);
    expect(parseProcessingResult({ ...valid, schema: 'other/v9' }).ok).toBe(false);
    expect(parseProcessingResult([]).ok).toBe(false);
  });

  it('parses quarantine keys and rejects foreign ones', () => {
    expect(parseQuarantineKey(storageKeys.quarantine(tenantId, materialId))).toEqual({ tenantId, materialId });
    expect(parseQuarantineKey('tenants/../etc/passwd')).toBeNull();
  });
});

describe('PDF inspection (LOCAL processor)', () => {
  async function pdf(pages: number, title = 'Doc'): Promise<Buffer> {
    const d = await PDFDocument.create();
    d.setTitle(title);
    for (let i = 0; i < pages; i++) d.addPage();
    return Buffer.from(await d.save());
  }

  it('validates, counts pages, reads metadata and builds a 1-page preview', async () => {
    const r = await inspectPdf(await pdf(4, 'Giáo trình'), 10 * 1024 * 1024);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(4);
    expect(r.title).toBe('Giáo trình');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await PDFDocument.load(r.preview)).getPageCount()).toBe(1);
  });

  it('rejects non-PDF, empty, truncated and oversized files', async () => {
    expect(await inspectPdf(Buffer.from('hello'), 1000)).toMatchObject({ ok: false, code: 'NOT_PDF' });
    expect(await inspectPdf(Buffer.alloc(0), 1000)).toMatchObject({ ok: false, code: 'EMPTY' });
    const full = await pdf(1);
    expect(await inspectPdf(full.subarray(0, full.length - 400), 10_000_000)).toMatchObject({ ok: false, code: 'CORRUPT' });
    expect(await inspectPdf(full, 10)).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });
});

describe('Local signed tokens (MOCK OSS policy / signed URL)', () => {
  const secret = Buffer.from('s'.repeat(32));
  it('round-trips, expires and detects tampering', () => {
    const t = signToken(secret, { exp: Math.floor(Date.now() / 1000) + 60, key: 'a' });
    expect(verifyToken<{ exp: number; key: string }>(secret, t)?.key).toBe('a');
    expect(verifyToken(secret, signToken(secret, { exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    const [b, s] = t.split('.');
    expect(verifyToken(secret, `${Buffer.from('{"exp":9999999999,"key":"b"}').toString('base64url')}.${s}`)).toBeNull();
    expect(verifyToken(Buffer.from('x'.repeat(32)), `${b}.${s}`)).toBeNull();
  });
});
