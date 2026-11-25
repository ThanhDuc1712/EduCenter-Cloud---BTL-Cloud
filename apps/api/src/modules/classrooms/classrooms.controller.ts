import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AnyRole, CurrentPrincipal, Roles } from '../../common/authz/policy.decorator';
import type { Principal } from '../../common/context/principal';
import { IsOptional } from 'class-validator';
import { IsYmd } from '../../common/http/validators';
import { ScheduleService } from '../schedule/schedule.service';
import { ClassroomQueryDto, ConflictCheckDto, CreateClassroomDto, CreateSessionDto, ReplaceSlotsDto, ScheduleQueryDto, UpdateClassroomDto, UpdateSessionDto } from './classrooms.dto';
import { ClassroomsService } from './classrooms.service';

@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classrooms: ClassroomsService) {}

  @Get()
  @AnyRole()
  list(@CurrentPrincipal() p: Principal, @Query() q: ClassroomQueryDto) {
    return this.classrooms.list(p, q);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateClassroomDto) {
    return this.classrooms.create(p, dto);
  }

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.classrooms.get(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClassroomDto) {
    return this.classrooms.update(p, id, dto);
  }

  @Put(':id/slots')
  @Roles('ADMIN')
  replaceSlots(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceSlotsDto) {
    return this.classrooms.replaceSlots(p, id, dto);
  }

  @Get(':id/students')
  @AnyRole()
  roster(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.classrooms.roster(p, id);
  }

  @Get(':id/sessions')
  @AnyRole()
  sessions(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.classrooms.sessions(p, id);
  }

  @Post(':id/sessions')
  @Roles('ADMIN', 'TEACHER')
  createSession(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSessionDto) {
    return this.classrooms.createSession(p, id, dto);
  }
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly classrooms: ClassroomsService) {}

  @Get(':id')
  @AnyRole()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.classrooms.getSession(p, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'TEACHER')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSessionDto) {
    return this.classrooms.updateSession(p, id, dto);
  }
}

class ConflictScanQueryDto {
  @IsOptional() @IsYmd() from?: string;
  @IsOptional() @IsYmd() to?: string;
}

@Controller('schedule')
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly classrooms: ClassroomsService,
  ) {}

  /** Day / week / month calendar, filtered by class, teacher (teaching schedule) or room (room schedule). */
  @Get()
  @AnyRole()
  calendar(@CurrentPrincipal() p: Principal, @Query() q: ScheduleQueryDto) {
    return this.schedule.calendar(p, q);
  }

  @Get('conflicts')
  @Roles('ADMIN')
  conflicts(@CurrentPrincipal() p: Principal, @Query() q: ConflictScanQueryDto) {
    return this.schedule.scanConflicts(p, q.from, q.to);
  }

  /** Dry run: would this timetable collide with existing teacher / room bookings? */
  @Post('check')
  @Roles('ADMIN')
  check(@CurrentPrincipal() p: Principal, @Body() dto: ConflictCheckDto) {
    return this.classrooms.checkConflicts(p, dto);
  }
}
