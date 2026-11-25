import { Module } from '@nestjs/common';
import { ScheduleService } from '../schedule/schedule.service';
import { ClassroomsController, ScheduleController, SessionsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';

@Module({ controllers: [ClassroomsController, SessionsController, ScheduleController], providers: [ClassroomsService, ScheduleService], exports: [ScheduleService] })
export class ClassroomsModule {}
