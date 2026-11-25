import OSS from 'ali-oss';
import { createHmac } from 'node:crypto';
import type { TelemetryService } from '../../common/observability/telemetry.service';
import type { BucketHealth, BucketRole, ListedObject, ObjectInfo, SignedUrlOptions, StorageProvider, UploadTarget } from './storage.types';

export interface OssConfig {
  region: string; // e.g. ap-southeast-1
  quarantineBucket: string;
  publishedBucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  internal: boolean;
}

interface OssError {
  status?: number;
  code?: string;
  name?: string;
}

/** Methods present in ali-oss but missing from @types/ali-oss. */
interface OssExtras {
  getBucketVersioning(name: string): Promise<{ versionStatus?: string }>;
  getBucketLifecycle(name: string): Promise<{ rules?: { id?: string; prefix?: string; status?: string; expiration?: { days?: number }; noncurrentVersionExpiration?: { noncurrentDays?: number } }[] }>;
}

const isNotFound = (err: unknown) => {
  const e = err as OssError;
  return e?.status === 404 || e?.code === 'NoSuchKey';
};

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function rfc5987(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * CLOUD MODE storage on Alibaba Cloud OSS. Both buckets are private; the browser uploads straight to
 * the quarantine bucket with a 5-minute V4 PostObject policy (size range + exact key, D-21) and
 * downloads with short-lived V4 signed URLs. The API's RAM user only needs the actions documented
 * in infra/aliyun/ram/api-policy.json — never the root account.
 */
export class OssStorageProvider implements StorageProvider {
  readonly kind = 'OSS' as const;
  private readonly clients: Record<BucketRole, OSS>;

  constructor(
    private readonly cfg: OssConfig,
    private readonly telemetry: TelemetryService,
  ) {
    const make = (bucket: string) =>
      new OSS({ region: `oss-${cfg.region}`, accessKeyId: cfg.accessKeyId, accessKeySecret: cfg.accessKeySecret, bucket, secure: true, internal: cfg.internal, authorizationV4: true, timeout: 20_000 });
    this.clients = { quarantine: make(cfg.quarantineBucket), published: make(cfg.publishedBucket) };
  }

  bucketName(role: BucketRole): string {
    return role === 'quarantine' ? this.cfg.quarantineBucket : this.cfg.publishedBucket;
  }

  private publicEndpoint(role: BucketRole): string {
    return `https://${this.bucketName(role)}.oss-${this.cfg.region}.aliyuncs.com`;
  }

  private measure<T>(op: string, role: BucketRole, fn: () => Promise<T>): Promise<T> {
    return this.telemetry.measure(`oss.${op}`, 'OSS', this.bucketName(role), fn);
  }

  /** V4 PostObject policy: exact key, content-length-range, content type, expiry. */
  async createUploadTarget(key: string, opts: { contentType: string; maxBytes: number; expiresInSeconds: number; metadata: Record<string, string> }): Promise<UploadTarget> {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const amzDate = `${date}T${now.toISOString().slice(11, 19).replace(/:/g, '')}Z`;
    const credential = `${this.cfg.accessKeyId}/${date}/${this.cfg.region}/oss/aliyun_v4_request`;
    const expiresAt = new Date(now.getTime() + opts.expiresInSeconds * 1000);
    const metaFields = Object.fromEntries(Object.entries(opts.metadata).map(([k, v]) => [`x-oss-meta-${k}`, v]));
    const policy = {
      expiration: expiresAt.toISOString(),
      conditions: [
        { bucket: this.cfg.quarantineBucket },
        ['eq', '$key', key],
        ['content-length-range', 1, opts.maxBytes],
        ['eq', '$Content-Type', opts.contentType],
        ['eq', '$success_action_status', '204'],
        { 'x-oss-signature-version': 'OSS4-HMAC-SHA256' },
        { 'x-oss-credential': credential },
        { 'x-oss-date': amzDate },
        ...Object.entries(metaFields).map(([k, v]) => ['eq', `$${k}`, v]),
      ],
    };
    const policyB64 = Buffer.from(JSON.stringify(policy)).toString('base64');
    const signingKey = hmac(hmac(hmac(hmac(`aliyun_v4${this.cfg.accessKeySecret}`, date), this.cfg.region), 'oss'), 'aliyun_v4_request');
    const signature = createHmac('sha256', signingKey).update(policyB64).digest('hex');
    return {
      method: 'POST',
      url: this.publicEndpoint('quarantine'),
      fields: {
        key,
        policy: policyB64,
        'x-oss-signature-version': 'OSS4-HMAC-SHA256',
        'x-oss-credential': credential,
        'x-oss-date': amzDate,
        'x-oss-signature': signature,
        'Content-Type': opts.contentType,
        success_action_status: '204',
        ...metaFields,
      },
      fileField: 'file',
      expiresAt: expiresAt.toISOString(),
      maxBytes: opts.maxBytes,
      provider: 'OSS',
    };
  }

  async head(role: BucketRole, key: string): Promise<ObjectInfo | null> {
    try {
      const r = await this.measure('head', role, () => this.clients[role].head(key));
      const h = r.res.headers as Record<string, string | undefined>;
      return {
        key,
        size: Number(h['content-length'] ?? 0),
        contentType: h['content-type'] ?? null,
        versionId: h['x-oss-version-id'] ?? null,
        lastModified: h['last-modified'] ? new Date(h['last-modified']) : null,
        etag: h.etag ?? null,
        metadata: (r.meta ?? {}) as Record<string, string>,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(role: BucketRole, key: string): Promise<Buffer | null> {
    try {
      const r = await this.measure('get', role, () => this.clients[role].get(key));
      return Buffer.isBuffer(r.content) ? r.content : Buffer.from(r.content as ArrayBuffer);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(role: BucketRole, key: string, body: Buffer, contentType: string, metadata: Record<string, string> = {}): Promise<{ versionId: string | null }> {
    const r = await this.measure('put', role, () => this.clients[role].put(key, body, { mime: contentType, meta: metadata as unknown as OSS.UserMeta }));
    return { versionId: ((r.res.headers as Record<string, string | undefined>)['x-oss-version-id']) ?? null };
  }

  async delete(role: BucketRole, key: string): Promise<void> {
    try {
      await this.measure('delete', role, () => this.clients[role].delete(key));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async list(role: BucketRole, prefix: string, max: number): Promise<{ objects: ListedObject[]; truncated: boolean }> {
    const r = await this.measure('list', role, () => this.clients[role].listV2({ prefix, 'max-keys': String(Math.min(max, 1000)) }, {}));
    return {
      objects: (r.objects ?? []).map((o) => ({ key: o.name, size: Number(o.size), lastModified: o.lastModified ? new Date(o.lastModified) : null })),
      truncated: Boolean(r.isTruncated),
    };
  }

  async signedGetUrl(role: BucketRole, key: string, opts: SignedUrlOptions): Promise<string> {
    const queries: Record<string, string> = {};
    if (opts.filename) queries['response-content-disposition'] = `${opts.disposition ?? 'inline'}; ${rfc5987(opts.filename)}`;
    if (opts.contentType) queries['response-content-type'] = opts.contentType;
    return this.clients[role].signatureUrlV4('GET', opts.expiresInSeconds, { queries }, key);
  }

  /** Copy-in-place with REPLACE metadata → new version + ObjectCreated event → Function Compute runs again. */
  async retrigger(key: string, metadata: Record<string, string> = {}): Promise<{ versionId: string | null }> {
    const head = await this.head('quarantine', key);
    if (!head) throw new Error('quarantine object not found');
    const r = await this.measure('copy', 'quarantine', () =>
      this.clients.quarantine.copy(key, key, { meta: { ...head.metadata, ...metadata, retrigger: String(Date.now()) } as unknown as OSS.UserMeta, headers: { 'x-oss-metadata-directive': 'REPLACE', 'Content-Type': head.contentType ?? 'application/pdf' } }),
    );
    return { versionId: ((r.res.headers as Record<string, string | undefined>)['x-oss-version-id']) ?? null };
  }

  async health(): Promise<BucketHealth[]> {
    const out: BucketHealth[] = [];
    for (const role of ['quarantine', 'published'] as const) {
      const name = this.bucketName(role);
      const client = this.clients[role] as unknown as Omit<OSS, 'getBucketLifecycle'> & OssExtras;
      const started = performance.now();
      try {
        const info = (await client.getBucketInfo(name)) as { bucket?: { AccessControlList?: { Grant?: string } } };
        const versioning = await client.getBucketVersioning(name).catch(() => ({ versionStatus: 'unknown' }));
        const lifecycle: Awaited<ReturnType<OssExtras['getBucketLifecycle']>> = await client.getBucketLifecycle(name).catch(() => ({ rules: [] }));
        const acl = info.bucket?.AccessControlList?.Grant ?? 'unknown';
        out.push({
          role,
          name,
          ok: true,
          versioning: versioning.versionStatus ?? 'Disabled',
          lifecycle: (lifecycle.rules ?? []).map((r) => `${r.id ?? r.prefix ?? 'rule'}: ${r.status ?? ''}${r.expiration?.days ? ` · xóa sau ${r.expiration.days} ngày` : ''}${r.noncurrentVersionExpiration?.noncurrentDays ? ` · phiên bản cũ ${r.noncurrentVersionExpiration.noncurrentDays} ngày` : ''}`),
          detail: `ACL ${acl}${acl === 'private' ? '' : ' — cảnh báo: bucket phải private'}`,
          latencyMs: Math.round(performance.now() - started),
        });
      } catch (err) {
        out.push({ role, name, ok: false, versioning: null, lifecycle: [], detail: `Lỗi truy cập bucket: ${(err as OssError).code ?? (err as OssError).name ?? 'unknown'}`, latencyMs: Math.round(performance.now() - started) });
      }
    }
    return out;
  }
}
