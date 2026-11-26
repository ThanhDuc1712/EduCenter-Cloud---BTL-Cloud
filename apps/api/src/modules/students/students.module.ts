import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { GradesModule } from '../grades/grades.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({ imports: [GradesModule, AttendanceModule], controllers: [StudentsController], providers: [StudentsService] })
export class StudentsModule {}
