import type { MaterialStatus } from '../../generated/prisma/client';

/**
 * Material lifecycle:
 *
 *   UPLOADING ──complete──▶ PROCESSING ──callback──▶ READY | REJECTED | FAILED
 *       │                      │  ▲                              │
 *       │ (callback may arrive │  └── retry / reconciler ◀── FAILED
 *       │  before "complete")  │
 *       └──────────────▶ READY | REJECTED | FAILED
 *   any non-deleted ──delete──▶ DELETED (terminal)
 *
 * PROCESSING → PROCESSING is a new processing attempt (new job). READY and REJECTED are final
 * verdicts for a source version; only deletion leaves them.
 */
export const MATERIAL_TRANSITIONS: Record<MaterialStatus, readonly MaterialStatus[]> = {
  UPLOADING: ['PROCESSING', 'READY', 'REJECTED', 'FAILED', 'DELETED'],
  PROCESSING: ['PROCESSING', 'READY', 'REJECTED', 'FAILED', 'DELETED'],
  FAILED: ['PROCESSING', 'READY', 'REJECTED', 'DELETED'],
  READY: ['DELETED'],
  REJECTED: ['DELETED'],
  DELETED: [],
};

export function canTransition(from: MaterialStatus, to: MaterialStatus): boolean {
  return MATERIAL_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATUSES: readonly MaterialStatus[] = ['READY', 'REJECTED', 'DELETED'];
