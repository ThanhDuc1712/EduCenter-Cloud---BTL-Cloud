import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@educenter/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Principal } from '../context/principal';
import { AppException } from '../errors/app-exception';

/**
 * Role scope (V2 §6.2): Admin = whole tenant; Teacher = classes where classrooms.teacher_id is theirs
 * (and the students in them); Student = themselves. Out-of-scope rows are reported as 404 so their
 * existence is not disclosed.
 */
export function classroomScope(p: Principal): Prisma.ClassroomWhereInput {
  if (p.role === 'ADMIN') return { tenantId: p.tenantId };
  if (p.role === 'TEACHER') return { tenantId: p.tenantId, teacherId: p.teacherId };
  return { tenantId: p.tenantId, enrollments: { some: { studentId: p.studentId } } };
}

export function studentScope(p: Principal): Prisma.StudentWhereInput {
  if (p.role === 'ADMIN') return { tenantId: p.tenantId };
  if (p.role === 'TEACHER') return { tenantId: p.tenantId, enrollments: { some: { classroom: { teacherId: p.teacherId } } } };
  return { tenantId: p.tenantId, id: p.studentId };
}

export function teacherScope(p: Principal): Prisma.TeacherWhereInput {
  if (p.role === 'ADMIN') return { tenantId: p.tenantId };
  if (p.role === 'TEACHER') return { tenantId: p.tenantId, id: p.teacherId };
  return { tenantId: p.tenantId, classrooms: { some: { enrollments: { some: { studentId: p.studentId } } } } };
}

export function sessionScope(p: Principal): Prisma.ClassSessionWhereInput {
  return { tenantId: p.tenantId, classroom: classroomScope(p) };
}

/** Admin, or the teacher assigned to the class. */
export function canManageClass(p: Principal, classroom: { teacherId: string | null }): boolean {
  return p.role === 'ADMIN' || (p.role === 'TEACHER' && !!p.teacherId && classroom.teacherId === p.teacherId);
}

export function assertCanManageClass(p: Principal, classroom: { teacherId: string | null }): void {
  if (!canManageClass(p, classroom)) {
    throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'Chỉ quản trị viên hoặc giáo viên phụ trách lớp được thực hiện thao tác này');
  }
}

export function notFound(what: string): AppException {
  return new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, `Không tìm thấy ${what}`);
}

export function conflict(code: string, message: string): AppException {
  return new AppException(code, HttpStatus.CONFLICT, message);
}

export function unprocessable(code: string, message: string): AppException {
  return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY, message);
}

export function badRequest(message: string, field?: string): AppException {
  return new AppException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, message, field ? [{ field, message }] : undefined);
}
