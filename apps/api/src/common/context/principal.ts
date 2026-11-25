export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

/** How the principal was established: a login session, or the I-01 demo context (AUTH_MODE=demo). */
export type AuthMethod = 'session' | 'demo';

/**
 * Server-resolved identity of the caller. Built only by SessionService (login session) or
 * DemoContextService (demo mode) from the database — never from request body, query or headers (INV-01).
 */
export interface Principal {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: Role;
  /** `admin` | `teacher:<code>` | `student:<code>` (also derived for session principals). */
  personaKey: string;
  displayName: string;
  teacherId?: string;
  studentId?: string;
  /** Absent for internal system principals (e.g. the reconciler). */
  authMethod?: AuthMethod;
  /** Set for session principals only. */
  userId?: string;
  email?: string;
}

export const isAdmin = (p: Principal): boolean => p.role === 'ADMIN';
