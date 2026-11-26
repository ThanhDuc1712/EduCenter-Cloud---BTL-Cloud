import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isYmd } from '../time';

/** `YYYY-MM-DD` calendar date that actually exists. */
export function IsYmd(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isYmd',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a date in YYYY-MM-DD format`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isYmd(v) },
    });
}

/** `HH:mm` 24-hour time. */
export function IsHhmm(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isHhmm',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a time in HH:mm format`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(v) },
    });
}

/** Positive VND amount as a decimal string (D-12) — up to 15 digits, no fractions. */
export function IsMoneyVnd(options?: ValidationOptions & { allowZero?: boolean }): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isMoneyVnd',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a VND amount as an integer string`, ...options },
      validator: {
        validate: (v: unknown) => typeof v === 'string' && /^\d{1,15}$/.test(v) && (options?.allowZero ? true : BigInt(v) > 0n),
      },
    });
}
