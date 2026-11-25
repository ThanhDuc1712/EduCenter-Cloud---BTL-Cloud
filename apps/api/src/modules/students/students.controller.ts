import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { CreateStudentDto, StudentQueryDto, UpdateStudentDto } from './students.dto';
import { StudentsService } from './students.service';

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: StudentQueryDto) {
    return this.students.list(p, q);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateStudentDto) {
    return this.students.create(p, dto);
  }

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.get(p, id);
  }

  @Get(':id/overview')
  @AnyRole()
  overview(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.overview(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(p, id, dto);
  }

  /** Archive = soft removal (history — grades, attendance, invoices — is kept). */
  @Post(':id/archive')
  @Roles('ADMIN')
  archive(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.update(p, id, { status: 'ARCHIVED' });
  }

  @Post(':id/restore')
  @Roles('ADMIN')
  restore(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.update(p, id, { status: 'ACTIVE' });
  }
}
