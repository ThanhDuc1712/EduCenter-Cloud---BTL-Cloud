import { storageKeys, type StorageProvider } from '../storage/storage.types';
import type { DispatchJob } from './materials.service';

/**
 * Copies the newest quarantine object of the material to the retry's key. "Newest existing" rather
 * than "previous attempt" so that one failed copy does not make every later retry fail.
 */
export async function retriggerFromLatest(storage: StorageProvider, job: DispatchJob): Promise<{ versionId: string | null }> {
  const { objects } = await storage.list('quarantine', storageKeys.materialPrefix('quarantine', job.tenantId, job.materialId), 100);
  const latest = objects.filter((o) => o.key !== job.sourceKey).sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))[0];
  if (!latest) throw new Error('quarantine object not found');
  return storage.retrigger(latest.key, job.sourceKey, { 'tenant-id': job.tenantId, 'material-id': job.materialId, 'correlation-id': job.correlationId, attempt: String(job.attempt) });
}
