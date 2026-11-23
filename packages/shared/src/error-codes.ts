/**
 * Machine-readable error codes returned in the standard error body
 * `{ code, message, requestId, fieldErrors? }` (V2 §14).
 * Must stay in sync with `ErrorCode` in packages/api-contract/components/schemas/common.yaml.
 * Feature modules add their own codes (e.g. ENROLLMENT_CAPACITY_EXCEEDED) via the contract.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
