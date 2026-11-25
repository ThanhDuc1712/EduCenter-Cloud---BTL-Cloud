import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/http/pagination';
import { IsYmd } from '../../common/http/validators';

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const PHONE = /^[0-9+ .-]{8,20}$/;

export class StudentQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(STUDENT_STATUSES) status?: (typeof STUDENT_STATUSES)[number];
  @IsOptional() @IsUUID() classroomId?: string;
}

export class CreateStudentDto {
  /** Optional: generated as HV#### when omitted. */
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code must be 2-32 uppercase letters, digits or -' }) code?: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(PHONE, { message: 'phone is not a valid phone number' }) phone?: string;
  @IsOptional() @IsYmd() dateOfBirth?: string;
  @IsOptional() @IsIn(['Nam', 'Nữ', 'Khác']) gender?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) guardianName?: string;
  @IsOptional() @Matches(PHONE, { message: 'guardianPhone is not a valid phone number' }) guardianPhone?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateStudentDto {
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @IsYmd() dateOfBirth?: string;
  @IsOptional() @IsIn(['Nam', 'Nữ', 'Khác']) gender?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) guardianName?: string;
  @IsOptional() @Matches(PHONE) guardianPhone?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsIn(STUDENT_STATUSES) status?: (typeof STUDENT_STATUSES)[number];
}
