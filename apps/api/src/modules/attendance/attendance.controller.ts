import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto } from '../../common/http/pagination';
import { AttendanceService } from './attendance.service';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;

class AttendanceRecordDto {
  @IsUUID() studentId: string;
  @IsIn(STATUSES) status: (typeof STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class RecordAttendanceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AttendanceRecordDto) records: AttendanceRecordDto[];
  /** Mark the session COMPLETED after saving (default true). */
  @IsOptional() @IsBoolean() markCompleted?: boolean;
}

class AttendanceHistoryQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** API path keeps `/sessions/:id/attendance` (D-04). */
  @Get('sessions/:id/attendance')
  @AnyRole()
  sheet(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.sheet(p, id);
  }

  @Put('sessions/:id/attendance')
  @Roles('ADMIN', 'TEACHER')
  record(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordAttendanceDto) {
    return this.attendance.record(p, id, dto.records, dto.markCompleted !== false);
  }

  @Get('attendance/pending')
  @Roles('ADMIN', 'TEACHER')
  pending(@CurrentPrincipal() p: Principal) {
    return this.attendance.pending(p);
  }

  @Get('attendance/history')
  @AnyRole()
  history(@CurrentPrincipal() p: Principal, @Query() q: AttendanceHistoryQueryDto) {
    return this.attendance.history(p, q);
  }

  @Get('classrooms/:id/attendance-summary')
  @AnyRole()
  classSummary(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.classSummary(p, id);
  }

  @Get('students/:id/attendance-summary')
  @AnyRole()
  studentSummary(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.studentSummary(p, id);
  }
}
