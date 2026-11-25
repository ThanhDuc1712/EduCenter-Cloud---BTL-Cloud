import type { TelemetryService } from '../../common/observability/telemetry.service';
import { OssStorageProvider } from './oss-storage.provider';
import { storageKeys } from './storage.types';

/** Offline checks of what the API sends to OSS. No network: signing is local, copy() is replaced. */
describe('OssStorageProvider (offline)', () => {
  const telemetry = { measure: (_n: string, _t: string, _b: string, fn: () => unknown) => fn() } as unknown as TelemetryService;
  const provider = () => new OssStorageProvider({ region: 'ap-southeast-1', quarantineBucket: 'q-bucket', publishedBucket: 'p-bucket', accessKeyId: 'test-id', accessKeySecret: 'test-secret-not-real', internal: false }, telemetry);
  const first = storageKeys.quarantine('t', 'm', 1, 'a');
  const second = storageKeys.quarantine('t', 'm', 2, 'b');

  it('signs a PostObject policy for exactly the ROADMAP quarantine key', async () => {
    const target = await provider().createUploadTarget(first, { contentType: 'application/pdf', maxBytes: 100, expiresInSeconds: 300, metadata: { 'correlation-id': 'c1' } });
    expect(target.url).toBe('https://q-bucket.oss-ap-southeast-1.aliyuncs.com');
    expect(target.fields.key).toBe('quarantine/t/m/1/a.pdf');
    const policy = JSON.parse(Buffer.from(target.fields.policy, 'base64').toString('utf8')) as { conditions: unknown[] };
    expect(policy.conditions).toEqual(expect.arrayContaining([['eq', '$key', first], ['content-length-range', 1, 100], ['eq', '$x-oss-meta-correlation-id', 'c1']]));
  });

  it('retry copies the old object to the new key with replaced metadata', async () => {
    const oss = provider();
    const copy = jest.fn().mockResolvedValue({ res: { headers: { 'x-oss-version-id': 'v2' } } });
    const head = jest.fn().mockResolvedValue({ res: { headers: { 'content-length': '5' } }, meta: { 'material-id': 'm', attempt: '1' } });
    Object.assign(oss, { clients: { quarantine: { copy, head }, published: {} } });
    await expect(oss.retrigger(first, second, { attempt: '2' })).resolves.toEqual({ versionId: 'v2' });
    expect(copy).toHaveBeenCalledWith(second, first, expect.objectContaining({ meta: expect.objectContaining({ 'material-id': 'm', attempt: '2' }), headers: expect.objectContaining({ 'x-oss-metadata-directive': 'REPLACE' }) }));
  });
});
