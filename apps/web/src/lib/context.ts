import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT'

export interface Principal {
  tenantId: string
  tenantSlug: string
  tenantName: string
  role: Role
  personaKey: string
  displayName: string
  teacherId?: string
  studentId?: string
  /** `session` = signed in with an account; `demo` = I-01 demo context (AUTH_MODE=demo). */
  authMethod?: 'session' | 'demo'
  userId?: string
  email?: string
}

export interface AppContext {
  principal: Principal
  demoMode: boolean
  authMode: 'session' | 'demo'
  mode: { storage: 'local' | 'oss'; processing: 'local' | 'aliyun-fc'; environment: string }
}

export interface AuthOptions {
  defaultTenantSlug: string
  registrationEnabled: boolean
  authMode: 'session' | 'demo'
}

/** Who the SERVER says we are (login session or demo context). The UI only adapts; the API enforces. */
export function useAppContext() {
  return useQuery({ queryKey: ['context'], queryFn: () => api.get<AppContext>('/context'), staleTime: 60_000 })
}

/** Public login-page settings (default center, whether sign-up is open). */
export function useAuthOptions() {
  return useQuery({ queryKey: ['auth', 'options'], queryFn: () => api.get<AuthOptions>('/auth/options'), staleTime: 5 * 60_000 })
}

export function usePrincipal(): Principal | undefined {
  return useAppContext().data?.principal
}
