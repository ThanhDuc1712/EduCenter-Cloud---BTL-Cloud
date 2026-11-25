/**
 * Storage provider abstraction (I-05). Business code (materials) only sees this interface;
 * LOCAL = filesystem under LOCAL_STORAGE_DIR, OSS = Alibaba Cloud Object Storage Service.
 * Buckets are logical: `quarantine` receives uploads, `published` holds processed documents
 * (`published/`), previews (`previews/`) and processing results (`results/`).
 */
export type BucketRole = 'quarantine' | 'published';

export interface UploadTarget {
  /** Always a multipart/form-data POST (OSS PostObject or the local upload endpoint). */
  method: 'POST';
  url: string;
  fields: Record<string, string>;
  /** Name of the form field that carries the file (must be the last field for OSS). */
  fileField: 'file';
  expiresAt: string;
  maxBytes: number;
  provider: 'LOCAL' | 'OSS';
}

export interface ObjectInfo {
  key: string;
  size: number;
  contentType: string | null;
  versionId: string | null;
  lastModified: Date | null;
  etag: string | null;
  metadata: Record<string, string>;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified: Date | null;
}

export interface BucketHealth {
  role: BucketRole;
  name: string;
  ok: boolean;
  versioning: string | null;
  lifecycle: string[];
  detail: string;
  latencyMs: number;
}

export interface SignedUrlOptions {
  expiresInSeconds: number;
  /** Suggested download filename (Content-Disposition). */
  filename?: string;
  /** inline = preview in browser, attachment = download. */
  disposition?: 'inline' | 'attachment';
  contentType?: string;
}

export interface StorageProvider {
  readonly kind: 'LOCAL' | 'OSS';
  bucketName(role: BucketRole): string;
  createUploadTarget(key: string, opts: { contentType: string; maxBytes: number; expiresInSeconds: number; metadata: Record<string, string> }): Promise<UploadTarget>;
  head(role: BucketRole, key: string): Promise<ObjectInfo | null>;
  get(role: BucketRole, key: string): Promise<Buffer | null>;
  put(role: BucketRole, key: string, body: Buffer, contentType: string, metadata?: Record<string, string>): Promise<{ versionId: string | null }>;
  delete(role: BucketRole, key: string): Promise<void>;
  list(role: BucketRole, prefix: string, max: number): Promise<{ objects: ListedObject[]; truncated: boolean }>;
  signedGetUrl(role: BucketRole, key: string, opts: SignedUrlOptions): Promise<string>;
  /** Copies a quarantine object to the next attempt's key; on OSS the copy raises ObjectCreated so the worker runs again. */
  retrigger(fromKey: string, toKey: string, metadata?: Record<string, string>): Promise<{ versionId: string | null }>;
  health(): Promise<BucketHealth[]>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * Key layout (ROADMAP P2-05, P0-13, P0-14). The prefix comes first so RAM policies and lifecycle rules
 * can be scoped. Quarantine keys are random per attempt; output keys are bound to the source object
 * version, so a second upload to the same key can never overwrite an accepted document.
 * Function Compute builds the same keys: functions/material-processor/keys.py (shared test vector).
 */
const output = (prefix: string, tenantId: string, materialId: string, attempt: number, versionId: string | null | undefined, ext: string) =>
  `${prefix}/${tenantId}/${materialId}/${attempt}/${versionTag(versionId)}.${ext}`;

/** Key-safe form of an OSS version ID. */
export const versionTag = (versionId: string | null | undefined) => (versionId ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'noversion';

export const storageKeys = {
  quarantine: (tenantId: string, materialId: string, attempt: number, objectId: string) => `quarantine/${tenantId}/${materialId}/${attempt}/${objectId}.pdf`,
  document: (tenantId: string, materialId: string, attempt: number, versionId: string | null | undefined) => output('published', tenantId, materialId, attempt, versionId, 'pdf'),
  preview: (tenantId: string, materialId: string, attempt: number, versionId: string | null | undefined, ext: 'png' | 'pdf') => output('previews', tenantId, materialId, attempt, versionId, ext),
  result: (tenantId: string, materialId: string, attempt: number, versionId: string | null | undefined) => output('results', tenantId, materialId, attempt, versionId, 'json'),
  /** Everything one material owns under a prefix (all attempts). */
  materialPrefix: (prefix: 'quarantine' | 'published' | 'previews' | 'results', tenantId: string, materialId: string) => `${prefix}/${tenantId}/${materialId}/`,
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const QUARANTINE_RE = new RegExp(`^quarantine/(${UUID})/(${UUID})/([1-9][0-9]{0,2})/${UUID}[.]pdf$`);
const OWNED_KEY_RE = new RegExp(`^(?:quarantine|published|previews|results)/${UUID}/(${UUID})/`);

export function parseQuarantineKey(key: string): { tenantId: string; materialId: string; attempt: number } | null {
  const m = QUARANTINE_RE.exec(key);
  return m ? { tenantId: m[1], materialId: m[2], attempt: Number(m[3]) } : null;
}

/** Material ID embedded in any object key of this layout (cloud dashboard). */
export const materialIdFromKey = (key: string): string | null => OWNED_KEY_RE.exec(key)?.[1] ?? null;
