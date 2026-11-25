import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { CourseQueryDto, CreateCourseDto, CreateRoomDto, UpdateCourseDto, UpdateRoomDto } from './courses.dto';
import { CoursesService } from './courses.service';

@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: CourseQueryDto) {
    return this.courses.list(p, q);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateCourseDto) {
    return this.courses.create(p, dto);
  }

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.get(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.update(p, id, dto);
  }

  @Post(':id/archive')
  @Roles('ADMIN')
  archive(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.update(p, id, { status: 'ARCHIVED' });
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.remove(p, id);
  }
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal) {
    return this.courses.rooms(p);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateRoomDto) {
    return this.courses.createRoom(p, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto) {
    return this.courses.updateRoom(p, id, dto);
  }
}
