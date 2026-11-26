import { Module } from '@nestjs/common';
import { CoursesController, RoomsController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({ controllers: [CoursesController, RoomsController], providers: [CoursesService] })
export class CoursesModule {}
