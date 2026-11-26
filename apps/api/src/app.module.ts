import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { CloudModule } from './modules/cloud/cloud.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { StorageModule } from './modules/storage/storage.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContextModule } from './modules/context/context.module';
import { CoursesModule } from './modules/courses/courses.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { GradesModule } from './modules/grades/grades.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StudentsModule } from './modules/students/students.module';
import { TeachersModule } from './modules/teachers/teachers.module';
import { TuitionModule } from './modules/tuition/tuition.module';

/**
 * Module registry. Each feature adds exactly one import line for its own module below.
 */
@Module({
  imports: [
    CommonModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    ContextModule,
    // Education management
    DashboardModule,
    StudentsModule,
    TeachersModule,
    CoursesModule,
    ClassroomsModule,
    EnrollmentsModule,
    AttendanceModule,
    GradesModule,
    TuitionModule,
    NotificationsModule,
    ReportsModule,
    // Learning materials + cross-cloud pipeline
    StorageModule,
    MaterialsModule,
    // Cloud operations
    CloudModule,
  ],
})
export class AppModule {}
