import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';

export interface FieldError {
  field: string;
  message: string;
}

/** Standard error body (V2 §14, INV-11). */
export interface ErrorBody {
  code: string;
  message: string;
  requestId: string;
  fieldErrors?: FieldError[];
}

/**
 * Throw this from feature code: `throw new AppException('ENROLLMENT_CAPACITY_EXCEEDED', 409, 'Class is full')`.
 * `message` must be safe to show to end users.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    status: HttpStatus,
    message: string,
    readonly fieldErrors?: FieldError[],
  ) {
    super({ code, message, fieldErrors }, status);
  }

  static validation(fieldErrors: FieldError[]): AppException {
    return new AppException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, 'Request validation failed', fieldErrors);
  }
}
