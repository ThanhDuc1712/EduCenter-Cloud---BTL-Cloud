import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError, errorMessage } from './api'

/** Shows the server error and maps `fieldErrors` back onto the form inputs. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>): void {
  if (err instanceof ApiError && setError) {
    for (const fe of err.fieldErrors) setError(fe.field as Path<T>, { message: fe.message })
  }
  toast.error(errorMessage(err))
}

/** Empty strings from inputs become `undefined` so optional fields are omitted from the request. */
export function clean<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (v !== '' && v !== undefined && v !== null) out[k] = v
  return out as Partial<T>
}
