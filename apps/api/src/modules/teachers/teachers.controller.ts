import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { CreateTeacherDto, TeacherQueryDto, UpdateTeacherDto } from './teachers.dto';
import { TeachersService } from './teachers.service';

@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: TeacherQueryDto) {
    return this.teachers.list(p, q);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateTeacherDto) {
    return this.teachers.create(p, dto);
  }

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teachers.get(p, id);
  }

  @Get(':id/overview')
  @AnyRole()
  overview(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teachers.overview(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeacherDto) {
    return this.teachers.update(p, id, dto);
  }
}
