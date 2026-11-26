import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/http/pagination';
import { IsMoneyVnd } from '../../common/http/validators';

export const COURSE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

export class CourseQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(COURSE_STATUSES) status?: (typeof COURSE_STATUSES)[number];
}

export class CreateCourseDto {
  @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code must be 2-32 uppercase letters, digits or -' }) code: string;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) content?: string;
  @IsOptional() @IsString() @MaxLength(50) level?: string;
  @IsMoneyVnd({ allowZero: true }) tuitionVnd: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2000) durationHours: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) totalSessions: number;
  @IsOptional() @IsIn(COURSE_STATUSES) status?: (typeof COURSE_STATUSES)[number];
}

export class UpdateCourseDto {
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) content?: string;
  @IsOptional() @IsString() @MaxLength(50) level?: string;
  @IsOptional() @IsMoneyVnd({ allowZero: true }) tuitionVnd?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) durationHours?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) totalSessions?: number;
  @IsOptional() @IsIn(COURSE_STATUSES) status?: (typeof COURSE_STATUSES)[number];
}

export class CreateRoomDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity: number;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
}

export class UpdateRoomDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity?: number;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
