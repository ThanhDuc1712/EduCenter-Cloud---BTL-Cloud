import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AnyRole, CurrentPrincipal } from '../../common/authz/policy.decorator';
import { classroomScope, sessionScope, studentScope } from '../../common/authz/scope';
import type { Principal } from '../../common/context/principal';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addDaysYmd, dateToYmd, localDayRange, localYmd, startOfIsoWeek, ymdToDate } from '../../common/time';
import { AttendanceModule } from '../attendance/attendance.module';
import { countAttendance } from '../attendance/attendance.service';
import { GradesModule } from '../grades/grades.module';
import { GradesService } from '../grades/grades.service';
import { TuitionModule } from '../tuition/tuition.module';
import { TuitionService } from '../tuition/tuition.service';
import { mapSession, sessionInclude } from '../schedule/schedule.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tuition: TuitionService,
    private readonly grades: GradesService,
  ) {}

  async build(p: Principal) {
    const today = localYmd();
    const todayRange = localDayRange(today);
    const upcomingRange = localDayRange(addDaysYmd(today, 1), addDaysYmd(today, 7));
    const last30 = localDayRange(addDaysYmd(today, -29), today);
    const classWhere = classroomScope(p);

    const [students, activeStudents, teachers, courses, classesTotal, classesActive, learningStudents, todaySessions, upcomingSessions, startingSoon, attendanceRows, recentActivity] = await Promise.all([
      this.prisma.student.count({ where: { AND: [studentScope(p), { status: { not: 'ARCHIVED' } }] } }),
      this.prisma.student.count({ where: { AND: [studentScope(p), { status: 'ACTIVE' }] } }),
      p.role === 'ADMIN' ? this.prisma.teacher.count({ where: { tenantId: p.tenantId, status: { not: 'INACTIVE' } } }) : Promise.resolve(null),
      p.role === 'ADMIN' ? this.prisma.course.count({ where: { tenantId: p.tenantId, status: 'ACTIVE' } }) : Promise.resolve(null),
      this.prisma.classroom.count({ where: classWhere }),
      this.prisma.classroom.count({ where: { AND: [classWhere, { status: 'ACTIVE' }] } }),
      this.prisma.enrollment.findMany({ where: { tenantId: p.tenantId, status: 'ACTIVE', classroom: { AND: [classWhere, { status: { in: ['ACTIVE', 'PLANNED'] } }] } }, distinct: ['studentId'], select: { studentId: true } }),
      this.prisma.classSession.findMany({ where: { AND: [sessionScope(p), { status: { not: 'CANCELLED' } }, { startsAt: { gte: todayRange.start, lt: todayRange.end } }] }, orderBy: { startsAt: 'asc' }, include: sessionInclude }),
      this.prisma.classSession.findMany({ where: { AND: [sessionScope(p), { status: 'SCHEDULED' }, { startsAt: { gte: upcomingRange.start, lt: upcomingRange.end } }] }, orderBy: { startsAt: 'asc' }, take: 8, include: sessionInclude }),
      this.prisma.classroom.findMany({
        where: { AND: [classWhere, { status: 'PLANNED' }, { startDate: { gte: ymdToDate(today), lte: ymdToDate(addDaysYmd(today, 45)) } }] },
        orderBy: { startDate: 'asc' },
        take: 6,
        include: { course: { select: { name: true } }, teacher: { select: { fullName: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      }),
      this.prisma.attendance.findMany({ where: { tenantId: p.tenantId, session: { AND: [sessionScope(p), { startsAt: { gte: last30.start, lt: last30.end } }] }, ...(p.role === 'STUDENT' ? { studentId: p.studentId } : {}) }, select: { status: true, session: { select: { startsAt: true } } } }),
      p.role === 'ADMIN' ? this.prisma.activityLog.findMany({ where: { tenantId: p.tenantId }, orderBy: { createdAt: 'desc' }, take: 12 }) : Promise.resolve([]),
    ]);

    // Attendance per ISO week (last ~5 weeks) for the trend chart.
    const weeks = new Map<string, Prisma.AttendanceGetPayload<object>['status'][]>();
    for (let w = 4; w >= 0; w--) weeks.set(startOfIsoWeek(addDaysYmd(today, -7 * w)), []);
    for (const r of attendanceRows) {
      const wk = startOfIsoWeek(localYmd(r.session.startsAt));
      if (weeks.has(wk)) weeks.get(wk)!.push(r.status);
    }

    const [finance, enrollmentByCourse, studentGrades] = await Promise.all([
      p.role === 'TEACHER' ? Promise.resolve(null) : this.tuition.summary(p),
      p.role === 'ADMIN' ? this.enrollmentByCourse(p.tenantId) : Promise.resolve([]),
      p.role === 'STUDENT' && p.studentId ? this.grades.studentGrades(p, p.studentId) : Promise.resolve(null),
    ]);

    return {
      role: p.role,
      generatedAt: new Date(),
      today,
      counts: {
        students,
        activeStudents,
        teachers,
        courses,
        classes: classesTotal,
        activeClasses: classesActive,
        learningStudents: learningStudents.length,
        todaySessions: todaySessions.length,
      },
      todaySessions: todaySessions.map(mapSession),
      upcomingSessions: upcomingSessions.map(mapSession),
      startingSoon: startingSoon.map((c) => ({ id: c.id, code: c.code, name: c.name, startDate: dateToYmd(c.startDate), course: c.course.name, teacher: c.teacher?.fullName ?? null, enrolled: c._count.enrollments, capacity: c.capacity })),
      attendance: {
        last30Days: countAttendance(attendanceRows.map((r) => r.status)),
        byWeek: [...weeks].map(([weekStart, statuses]) => ({ weekStart, ...countAttendance(statuses) })),
      },
      finance: finance && {
        billedVnd: finance.billedVnd,
        collectedVnd: finance.collectedVnd,
        outstandingVnd: finance.outstandingVnd,
        collectionRate: finance.collectionRate,
        overdue: finance.overdue,
        revenueByMonth: finance.revenueByMonth,
      },
      enrollmentByCourse,
      grades: studentGrades && { overallAverage: studentGrades.overallAverage, classes: studentGrades.classes.map((c) => ({ classroom: c.classroom, average: c.average, band: c.band })) },
      recentActivity,
    };
  }

  private async enrollmentByCourse(tenantId: string) {
    const rows = await this.prisma.enrollment.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { classroom: { select: { course: { select: { id: true, code: true, name: true } } } } } });
    const counts = new Map<string, { course: { id: string; code: string; name: string }; count: number }>();
    for (const r of rows) {
      const c = r.classroom.course;
      counts.set(c.id, { course: c, count: (counts.get(c.id)?.count ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @AnyRole()
  get(@CurrentPrincipal() p: Principal) {
    return this.dashboard.build(p);
  }
}

@Module({ imports: [TuitionModule, GradesModule, AttendanceModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
