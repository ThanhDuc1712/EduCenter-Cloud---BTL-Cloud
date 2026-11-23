import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppException } from './app-exception';
import { resolve } from './all-exceptions.filter';

describe('AllExceptionsFilter.resolve', () => {
  it('passes AppException code, message and fieldErrors through', () => {
    const r = resolve(AppException.validation([{ field: 'email', message: 'email must be an email' }]));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      fieldErrors: [{ field: 'email', message: 'email must be an email' }],
    });
  });

  it('maps framework HttpExceptions to safe catalogue messages', () => {
    const r = resolve(new NotFoundException('Cannot GET /api/v1/secret-internal-path'));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' });
    expect(resolve(new BadRequestException('x')).body.code).toBe('VALIDATION_FAILED');
  });

  it('hides unknown errors behind INTERNAL_ERROR without stack or message', () => {
    const r = resolve(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(r.status).toBe(500);
    expect(r.unexpected).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|hunter2|stack/);
  });

  it('maps Prisma unique violation to a generic 409 without constraint names', () => {
    const prismaError = Object.assign(new Error('Unique constraint failed on the fields: (`tenant_id`,`email`)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['tenant_id', 'email'] },
    });
    const r = resolve(prismaError);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
    expect(JSON.stringify(r.body)).not.toMatch(/tenant_id|email|P2002/);
  });

  it('maps Prisma initialization errors to 503', () => {
    const r = resolve(Object.assign(new Error('Can not reach database'), { name: 'PrismaClientInitializationError' }));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
  });
});
