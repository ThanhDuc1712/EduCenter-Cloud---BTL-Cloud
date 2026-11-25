/**
 * The SPA's HTTP client for business endpoints. Same-origin (D-03): relative `/api/v1`, the persona
 * cookie is HttpOnly and sent automatically; nothing is stored in localStorage. The client never sends
 * tenant or role — the server derives both (demo context).
 */
export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly fieldErrors: FieldError[]
  constructor(status: number, code: string, message: string, requestId?: string, fieldErrors: FieldError[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.fieldErrors = fieldErrors
  }
}

export interface Page<T> {
  items: T[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

type Query = Record<string, string | number | boolean | undefined | null>

export function qs(params: Query = {}): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ''
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ API')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const e = (json ?? {}) as { code?: string; message?: string; requestId?: string; fieldErrors?: FieldError[] }
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Lỗi HTTP ${res.status}`, e.requestId, e.fieldErrors ?? [])
  }
  return json as T
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>('GET', `${path}${qs(params)}`),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, headers),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const details = err.fieldErrors.length && err.code === 'VALIDATION_FAILED' ? `: ${err.fieldErrors.map((f) => f.message).slice(0, 3).join('; ')}` : ''
    return `${err.message}${details}`
  }
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

/** Uploads straight to the storage target (OSS PostObject in cloud mode, local endpoint otherwise). */
export function uploadToTarget(target: { url: string; fields: Record<string, string>; fileField: string }, file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(target.fields)) form.append(k, v)
    form.append(target.fileField, file) // must be the last field for OSS
    const xhr = new XMLHttpRequest()
    xhr.open('POST', target.url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', `Tải lên thất bại (HTTP ${xhr.status})`)))
    xhr.onerror = () => reject(new ApiError(0, 'UPLOAD_FAILED', 'Không tải lên được tệp (lỗi mạng hoặc CORS của bucket)'))
    xhr.send(form)
  })
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
