import { createHmac, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { signToken } from './signed-token';
import type { BucketHealth, BucketRole, ListedObject, ObjectInfo, SignedUrlOptions, StorageProvider, UploadTarget } from './storage.types';

interface Sidecar {
  contentType: string;
  versionId: string;
  metadata: Record<string, string>;
  versions: { versionId: string; at: string; size: number }[];
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,400}$/;
const BUCKETS: Record<BucketRole, string> = { quarantine: 'educenter-quarantine-local', published: 'educenter-published-local' };

export interface LocalUploadClaims {
  exp: number;
  bucket: BucketRole;
  key: string;
  maxBytes: number;
  contentType: string;
  metadata: Record<string, string>;
}

export interface LocalDownloadClaims {
  exp: number;
  bucket: BucketRole;
  key: string;
  filename?: string;
  disposition: 'inline' | 'attachment';
  contentType?: string;
}

/**
 * LOCAL MODE storage: plain files under LOCAL_STORAGE_DIR/<bucket>/<key> with a JSON sidecar for
 * content type, metadata and version history. Upload policies and signed URLs are emulated with
 * short-lived HMAC tokens checked by LocalStorageController. Not a cloud service.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'LOCAL' as const;
  readonly tokenSecret: Buffer;

  constructor(
    private readonly root: string,
    secret: string,
  ) {
    this.tokenSecret = createHmac('sha256', secret).update('educenter-local-storage-v1').digest();
  }

  bucketName(role: BucketRole): string {
    return BUCKETS[role];
  }

  pathFor(role: BucketRole, key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('invalid object key');
    const base = path.resolve(this.root, BUCKETS[role]);
    const full = path.resolve(base, key);
    if (!full.startsWith(base + path.sep)) throw new Error('invalid object key');
    return full;
  }

  private async readSidecar(file: string): Promise<Sidecar | null> {
    try {
      return JSON.parse(await fs.readFile(`${file}.meta.json`, 'utf8')) as Sidecar;
    } catch {
      return null;
    }
  }

  async createUploadTarget(key: string, opts: { contentType: string; maxBytes: number; expiresInSeconds: number; metadata: Record<string, string> }): Promise<UploadTarget> {
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    const token = signToken(this.tokenSecret, { exp, bucket: 'quarantine', key, maxBytes: opts.maxBytes, contentType: opts.contentType, metadata: opts.metadata } satisfies LocalUploadClaims);
    return { method: 'POST', url: '/api/v1/storage/local/upload', fields: { token }, fileField: 'file', expiresAt: new Date(exp * 1000).toISOString(), maxBytes: opts.maxBytes, provider: 'LOCAL' };
  }

  async head(role: BucketRole, key: string): Promise<ObjectInfo | null> {
    const file = this.pathFor(role, key);
    try {
      const stat = await fs.stat(file);
      const meta = await this.readSidecar(file);
      return { key, size: stat.size, contentType: meta?.contentType ?? null, versionId: meta?.versionId ?? null, lastModified: stat.mtime, etag: null, metadata: meta?.metadata ?? {} };
    } catch {
      return null;
    }
  }

  async get(role: BucketRole, key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(role, key));
    } catch {
      return null;
    }
  }

  async put(role: BucketRole, key: string, body: Buffer, contentType: string, metadata: Record<string, string> = {}): Promise<{ versionId: string | null }> {
    const file = this.pathFor(role, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const previous = await this.readSidecar(file);
    const versionId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const tmp = `${file}.${versionId}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
    const sidecar: Sidecar = { contentType, versionId, metadata, versions: [...(previous?.versions ?? []), { versionId, at: new Date().toISOString(), size: body.length }].slice(-10) };
    await fs.writeFile(`${file}.meta.json`, JSON.stringify(sidecar));
    return { versionId };
  }

  async delete(role: BucketRole, key: string): Promise<void> {
    const file = this.pathFor(role, key);
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.meta.json`, { force: true });
  }

  async list(role: BucketRole, prefix: string, max: number): Promise<{ objects: ListedObject[]; truncated: boolean }> {
    const base = path.resolve(this.root, BUCKETS[role]);
    const out: ListedObject[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length > max) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith('.meta.json') && !e.name.endsWith('.tmp')) {
          const key = path.relative(base, full).split(path.sep).join('/');
          if (!key.startsWith(prefix)) continue;
          const stat = await fs.stat(full);
          out.push({ key, size: stat.size, lastModified: stat.mtime });
        }
      }
    };
    await walk(base);
    out.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    return { objects: out.slice(0, max), truncated: out.length > max };
  }

  async signedGetUrl(role: BucketRole, key: string, opts: SignedUrlOptions): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    const token = signToken(this.tokenSecret, { exp, bucket: role, key, filename: opts.filename, disposition: opts.disposition ?? 'inline', contentType: opts.contentType } satisfies LocalDownloadClaims);
    return `/api/v1/storage/local/object?token=${encodeURIComponent(token)}`;
  }

  async retrigger(fromKey: string, toKey: string, metadata: Record<string, string> = {}): Promise<{ versionId: string | null }> {
    const info = await this.head('quarantine', fromKey);
    const body = info ? await this.get('quarantine', fromKey) : null;
    if (!info || !body) throw new Error('quarantine object not found');
    return this.put('quarantine', toKey, body, info.contentType ?? 'application/pdf', { ...info.metadata, ...metadata });
  }

  async health(): Promise<BucketHealth[]> {
    const out: BucketHealth[] = [];
    for (const role of ['quarantine', 'published'] as const) {
      const started = performance.now();
      const dir = path.resolve(this.root, BUCKETS[role]);
      let ok = true;
      let detail = `Thư mục cục bộ ${dir}`;
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.access(dir);
      } catch (err) {
        ok = false;
        detail = `Không truy cập được thư mục: ${(err as Error).name}`;
      }
      out.push({ role, name: BUCKETS[role], ok, versioning: 'Local sidecar (10 phiên bản gần nhất)', lifecycle: ['Không áp dụng ở LOCAL MODE — dọn dẹp bằng reconciler'], detail, latencyMs: Math.round(performance.now() - started) });
    }
    return out;
  }
}
