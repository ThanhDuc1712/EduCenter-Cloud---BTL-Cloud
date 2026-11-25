/**
 * Storage provider abstraction (I-05). Business code (materials) only sees this interface;
 * LOCAL = filesystem under LOCAL_STORAGE_DIR, OSS = Alibaba Cloud Object Storage Service.
 * Buckets are logical: `quarantine` receives uploads, `published` holds processed documents,
 * previews and processing results (`results/…`).
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
  /** Re-emits an ObjectCreated event for the quarantine object (OSS: copy onto itself) so the worker runs again. */
  retrigger(key: string, metadata?: Record<string, string>): Promise<{ versionId: string | null }>;
  health(): Promise<BucketHealth[]>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** Key layout — tenant first so RAM policies / lifecycle rules can be prefix-scoped. */
export const storageKeys = {
  quarantine: (tenantId: string, materialId: string) => `tenants/${tenantId}/materials/${materialId}/source.pdf`,
  document: (tenantId: string, materialId: string) => `tenants/${tenantId}/materials/${materialId}/document.pdf`,
  preview: (tenantId: string, materialId: string, ext: 'png' | 'pdf') => `tenants/${tenantId}/materials/${materialId}/preview.${ext}`,
  result: (tenantId: string, materialId: string) => `results/${tenantId}/${materialId}.json`,
};

const KEY_RE = /^tenants\/([0-9a-f-]{36})\/materials\/([0-9a-f-]{36})\/source\.pdf$/;

export function parseQuarantineKey(key: string): { tenantId: string; materialId: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { tenantId: m[1], materialId: m[2] } : null;
}
