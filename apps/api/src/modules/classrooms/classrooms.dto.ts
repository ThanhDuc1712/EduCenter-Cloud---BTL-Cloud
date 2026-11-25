import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQueryDto } from '../../common/http/pagination';
import { IsHhmm, IsMoneyVnd, IsYmd } from '../../common/http/validators';

export const CLASSROOM_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;

export class ClassroomQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(CLASSROOM_STATUSES) status?: (typeof CLASSROOM_STATUSES)[number];
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
}

export class SlotDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(7) dayOfWeek: number;
  @IsHhmm() startTime: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(600) durationMinutes: number;
  @IsOptional() @IsUUID() roomId?: string;
}

export class CreateClassroomDto {
  @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code must be 2-32 uppercase letters, digits or -' }) code: string;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsUUID() courseId: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() roomId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity: number;
  @IsYmd() startDate: string;
  @IsYmd() endDate: string;
  @IsOptional() @IsIn(CLASSROOM_STATUSES) status?: (typeof CLASSROOM_STATUSES)[number];
  @IsOptional() @IsMoneyVnd({ allowZero: true }) tuitionVnd?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(14) @ValidateNested({ each: true }) @Type(() => SlotDto) slots?: SlotDto[];
  /** Generate class sessions from the weekly slots (with teacher/room conflict checks). Default true. */
  @IsOptional() @IsBoolean() generateSessions?: boolean;
}

export class UpdateClassroomDto {
  @IsOptional() @Matches(/^[A-Z0-9-]{2,32}$/) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) capacity?: number;
  @IsOptional() @IsYmd() startDate?: string;
  @IsOptional() @IsYmd() endDate?: string;
  @IsOptional() @IsIn(CLASSROOM_STATUSES) status?: (typeof CLASSROOM_STATUSES)[number];
  @IsOptional() @IsMoneyVnd({ allowZero: true }) tuitionVnd?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReplaceSlotsDto {
  @IsArray() @ArrayMaxSize(14) @ValidateNested({ each: true }) @Type(() => SlotDto) slots: SlotDto[];
  /** Replace future, not-yet-attended sessions with ones generated from the new timetable. */
  @IsOptional() @IsBoolean() regenerate?: boolean;
}

export class CreateSessionDto {
  @IsYmd() date: string;
  @IsHhmm() startTime: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(600) durationMinutes: number;
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @IsString() @MaxLength(300) topic?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateSessionDto {
  @IsOptional() @IsYmd() date?: string;
  @IsOptional() @IsHhmm() startTime?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(600) durationMinutes?: number;
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @IsString() @MaxLength(300) topic?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsIn(SESSION_STATUSES) status?: (typeof SESSION_STATUSES)[number];
}

export class ScheduleQueryDto {
  @IsOptional() @IsYmd() from?: string;
  @IsOptional() @IsYmd() to?: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeCancelled?: boolean;
}

export class ConflictCheckDto {
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() roomId?: string;
  @IsYmd() startDate: string;
  @IsYmd() endDate: string;
  @IsArray() @ArrayMaxSize(14) @ValidateNested({ each: true }) @Type(() => SlotDto) slots: SlotDto[];
}
