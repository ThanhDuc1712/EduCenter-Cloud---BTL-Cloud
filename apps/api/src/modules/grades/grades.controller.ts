import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { IsYmd } from '../../common/http/validators';
import { GradesService } from './grades.service';

const TYPES = ['QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL', 'OTHER'] as const;

class CreateAssessmentDto {
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsIn(TYPES) type: (typeof TYPES)[number];
  @Type(() => Number) @IsInt() @Min(0) @Max(100) weight: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100) maxScore?: number;
  @IsOptional() @IsYmd() heldOn?: string;
}

class UpdateAssessmentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsIn(TYPES) type?: (typeof TYPES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100) maxScore?: number;
  @IsOptional() @IsYmd() heldOn?: string;
}

class GradeDto {
  @IsUUID() studentId: string;
  @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) score: number | null;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

class SaveGradesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => GradeDto) grades: GradeDto[];
}

class BandDto {
  @IsString() @MinLength(1) @MaxLength(50) label: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10) minScore: number;
}

class ReplaceBandsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BandDto) bands: BandDto[];
}

@Controller()
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get('classrooms/:id/assessments')
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.grades.listAssessments(p, id);
  }

  @Post('classrooms/:id/assessments')
  @Roles('ADMIN', 'TEACHER')
  create(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAssessmentDto) {
    return this.grades.createAssessment(p, id, dto);
  }

  @Get('classrooms/:id/gradebook')
  @AnyRole()
  gradebook(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.grades.gradebook(p, id);
  }

  @Patch('assessments/:id')
  @Roles('ADMIN', 'TEACHER')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssessmentDto) {
    return this.grades.updateAssessment(p, id, dto);
  }

  @Delete('assessments/:id')
  @Roles('ADMIN', 'TEACHER')
  remove(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.grades.deleteAssessment(p, id);
  }

  @Get('assessments/:id/grades')
  @AnyRole()
  sheet(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.grades.assessmentGrades(p, id);
  }

  @Put('assessments/:id/grades')
  @Roles('ADMIN', 'TEACHER')
  save(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveGradesDto) {
    return this.grades.saveGrades(p, id, dto.grades);
  }

  @Get('students/:id/grades')
  @AnyRole()
  student(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.grades.studentGrades(p, id);
  }

  @Get('grade-bands')
  @AnyRole()
  bands(@CurrentPrincipal() p: Principal) {
    return this.grades.bands(p.tenantId);
  }

  @Put('grade-bands')
  @Roles('ADMIN')
  replaceBands(@CurrentPrincipal() p: Principal, @Body() dto: ReplaceBandsDto) {
    return this.grades.replaceBands(p, dto.bands);
  }
}
