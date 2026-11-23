import type { ValidationError } from 'class-validator';
import { AppException, type FieldError } from './app-exception';

const MAX_FIELD_ERRORS = 50;

/** Flattens nested class-validator errors into `[{ field: 'a.b', message }]` without echoing values. */
export function toFieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const message of Object.values(error.constraints ?? {})) {
      out.push({ field, message });
    }
    if (error.children?.length) out.push(...toFieldErrors(error.children, field));
    if (out.length >= MAX_FIELD_ERRORS) break;
  }
  return out.slice(0, MAX_FIELD_ERRORS);
}

export function validationExceptionFactory(errors: ValidationError[]): AppException {
  return AppException.validation(toFieldErrors(errors));
}
