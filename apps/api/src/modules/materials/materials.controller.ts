import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { PageQueryDto } from '../../common/http/pagination';
import { MaterialsService } from './materials.service';

const CATEGORIES = ['LECTURE', 'SYLLABUS', 'EXERCISE', 'EXAM', 'REFERENCE', 'OTHER'] as const;
const VISIBILITIES = ['COURSE', 'CLASS', 'PERSONAL'] as const;
const STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'DELETED'] as const;

class CreateMaterialDto {
  @IsString() @MinLength(2) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(CATEGORIES) category: (typeof CATEGORIES)[number];
  @IsIn(VISIBILITIES) visibility: (typeof VISIBILITIES)[number];
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsString() @MinLength(1) @MaxLength(255) @Matches(/^[^\\/:*?"<>|]+$/, { message: 'filename contains invalid characters' }) filename: string;
  @IsString() @MaxLength(100) contentType: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1024 * 1024 * 1024) size: number;
}

class UpdateMaterialDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: (typeof CATEGORIES)[number];
}

class MaterialQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsIn(CATEGORIES) category?: (typeof CATEGORIES)[number];
  @IsOptional() @IsIn(VISIBILITIES) visibility?: (typeof VISIBILITIES)[number];
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() classroomId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
}

class AccessQueryDto {
  @IsIn(['preview', 'download']) kind: 'preview' | 'download';
}

/**
 * Learning materials. Cross-cloud flow: POST (metadata + OSS upload policy) → browser uploads
 * directly to OSS quarantine → POST :id/complete → Function Compute → HMAC callback → READY →
 * GET :id/access (signed URL).
 */
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: MaterialQueryDto) {
    return this.materials.list(p, q);
  }

  @Post()
  @Roles('ADMIN', 'TEACHER')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateMaterialDto) {
    return this.materials.create(p, dto);
  }

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.get(p, id);
  }

  @Get(':id/history')
  @Roles('ADMIN', 'TEACHER')
  history(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.history(p, id);
  }

  @Post(':id/upload-policy')
  @Roles('ADMIN', 'TEACHER')
  renew(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.renewUpload(p, id);
  }

  @Post(':id/complete')
  @Roles('ADMIN', 'TEACHER')
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.complete(p, id);
  }

  @Get(':id/access')
  @AnyRole()
  access(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() q: AccessQueryDto) {
    return this.materials.access(p, id, q.kind);
  }

  @Post(':id/retry')
  @Roles('ADMIN', 'TEACHER')
  retry(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.retry(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'TEACHER')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialDto) {
    return this.materials.update(p, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'TEACHER')
  remove(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.remove(p, id);
  }
}
