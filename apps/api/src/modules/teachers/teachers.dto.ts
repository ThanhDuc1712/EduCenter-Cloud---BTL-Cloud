import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/http/pagination';
import { IsYmd } from '../../common/http/validators';

export const TEACHER_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;

export class TeacherQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(TEACHER_STATUSES) status?: (typeof TEACHER_STATUSES)[number];
}

export class CreateTeacherDto {
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code must be 2-32 uppercase letters, digits or -' }) code?: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(/^[0-9+ .-]{8,20}$/) phone?: string;
  @IsString() @MinLength(2) @MaxLength(200) specialization: string;
  @IsOptional() @IsString() @MaxLength(200) qualification?: string;
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsOptional() @IsYmd() hiredAt?: string;
  @IsOptional() @IsIn(TEACHER_STATUSES) status?: (typeof TEACHER_STATUSES)[number];
}

export class UpdateTeacherDto {
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(/^[0-9+ .-]{8,20}$/) phone?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) specialization?: string;
  @IsOptional() @IsString() @MaxLength(200) qualification?: string;
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsOptional() @IsYmd() hiredAt?: string;
  @IsOptional() @IsIn(TEACHER_STATUSES) status?: (typeof TEACHER_STATUSES)[number];
}
