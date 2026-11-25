import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertCircle, BookOpen, CalendarClock, GraduationCap, School, TrendingUp, Users, Wallet } from 'lucide-react'
import { BarList, ColumnChart, SegmentBar } from '@/components/charts'
import { EmptyState, PageHeader, QueryView, StatCard, StatusBadge } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { usePrincipal } from '@/lib/context'
import * as f from '@/lib/format'
import type { AttendanceCounts, Session } from '@/lib/types'
import { attendanceParts } from '@/lib/viz'

interface Dashboard {
  role: string
  today: string
  counts: { students: number; activeStudents: number; teachers: number | null; courses: number | null; classes: number; activeClasses: number; learningStudents: number; todaySessions: number }
  todaySessions: Session[]
  upcomingSessions: Session[]
  startingSoon: { id: string; code: string; name: string; startDate: string; course: string; teacher: string | null; enrolled: number; capacity: number }[]
  attendance: { last30Days: AttendanceCounts; byWeek: (AttendanceCounts & { weekStart: string })[] }
  finance: { billedVnd: string; collectedVnd: string; outstandingVnd: string; collectionRate: number; overdue: { count: number; amountVnd: string }; revenueByMonth: { month: string; amountVnd: string }[] } | null
  enrollmentByCourse: { course: { id: string; code: string; name: string }; count: number }[]
  grades: { overallAverage: number | null; classes: { classroom: { id: string; code: string; name: string }; average: number | null; band: string | null }[] } | null
  recentActivity: { id: string; actorName: string; actorRole: string; summary: string; createdAt: string }[]
}

function SessionList({ sessions, emptyText }: { sessions: Session[]; emptyText: string }) {
  if (!sessions.length) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
  return (
    <ul className="divide-y">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-2.5">
          <div className="w-20 shrink-0 text-sm font-medium tabular-nums">
            {f.time(s.startsAt)}–{f.time(s.endsAt)}
            <div className="text-xs font-normal text-muted-foreground">{f.date(s.startsAt)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <Link to={`/classes/${s.classroom.id}`} className="block truncate text-sm font-medium hover:underline">
              {s.classroom.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {s.teacher?.fullName ?? 'Chưa phân công'} · {s.room?.name ?? 'Chưa có phòng'}
            </p>
          </div>
          <StatusBadge kind="session" value={s.status} />
        </li>
      ))}
    </ul>
  )
}

export function DashboardPage() {
  const p = usePrincipal()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 60_000 })
  const greeting = p?.role === 'ADMIN' ? 'Tổng quan trung tâm' : p?.role === 'TEACHER' ? `Xin chào, ${p.displayName}` : `Xin chào, ${p?.displayName ?? ''}`
  return (
    <>
      <PageHeader title={greeting} description={q.data ? `Số liệu thời gian thực từ cơ sở dữ liệu · hôm nay ${f.date(q.data.today)}` : undefined} />
      <QueryView query={q} rows={8}>
        {(d) => (
          <div className="space-y-5">
            <div className={d.role === 'ADMIN' ? 'grid grid-cols-2 gap-3 md:grid-cols-3' : 'grid grid-cols-2 gap-3 md:grid-cols-4'}>
              {d.role === 'ADMIN' ? (
                <>
                  <StatCard label="Tổng học viên" value={d.counts.students} hint={`${d.counts.activeStudents} đang hoạt động`} icon={Users} />
                  <StatCard label="Giáo viên" value={d.counts.teachers} icon={GraduationCap} />
                  <StatCard label="Khóa học đang mở" value={d.counts.courses} icon={BookOpen} />
                  <StatCard label="Lớp học" value={d.counts.classes} hint={`${d.counts.activeClasses} lớp đang hoạt động`} icon={School} />
                  <StatCard label="Học viên đang theo học" value={d.counts.learningStudents} icon={TrendingUp} tone="success" />
                  <StatCard label="Buổi học hôm nay" value={d.counts.todaySessions} icon={CalendarClock} />
                </>
              ) : (
                <>
                  <StatCard label={d.role === 'TEACHER' ? 'Lớp phụ trách' : 'Lớp đang học'} value={d.counts.activeClasses} hint={`${d.counts.classes} lớp tất cả`} icon={School} />
                  {d.role === 'TEACHER' ? <StatCard label="Học viên của tôi" value={d.counts.learningStudents} icon={Users} /> : <StatCard label="Điểm trung bình" value={f.score(d.grades?.overallAverage)} icon={TrendingUp} />}
                  <StatCard label="Buổi học hôm nay" value={d.counts.todaySessions} icon={CalendarClock} />
                  <StatCard label="Chuyên cần 30 ngày" value={`${d.attendance.last30Days.rate}%`} icon={TrendingUp} tone={d.attendance.last30Days.rate >= 80 ? 'success' : 'warning'} />
                </>
              )}
              {d.finance ? (
                <>
                  <StatCard label={d.role === 'ADMIN' ? 'Tổng học phí cần thu' : 'Học phí phải đóng'} value={f.vndShort(d.finance.billedVnd)} hint={f.vnd(d.finance.billedVnd)} icon={Wallet} />
                  <StatCard label="Đã thu" value={f.vndShort(d.finance.collectedVnd)} hint={`Tỷ lệ thu ${d.finance.collectionRate}%`} icon={Wallet} tone="success" />
                  <StatCard label="Công nợ" value={f.vndShort(d.finance.outstandingVnd)} hint={`${d.finance.overdue.count} khoản quá hạn · ${f.vnd(d.finance.overdue.amountVnd)}`} icon={AlertCircle} tone={d.finance.overdue.count ? 'danger' : 'default'} />
                </>
              ) : null}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Lịch học hôm nay</CardTitle>
                  <Link to="/schedule" className="text-xs text-primary hover:underline">
                    Xem lịch
                  </Link>
                </CardHeader>
                <CardContent>
                  <SessionList sessions={d.todaySessions} emptyText="Hôm nay không có buổi học" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Chuyên cần 30 ngày</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-3xl font-semibold tabular-nums">{d.attendance.last30Days.rate}%</p>
                  <SegmentBar parts={attendanceParts(d.attendance.last30Days)} />
                  <ColumnChart ariaLabel="Tỷ lệ chuyên cần theo tuần" height={140} format={(n) => `${n}%`} data={d.attendance.byWeek.map((w) => ({ label: f.date(w.weekStart).slice(0, 5), title: `Tuần từ ${f.date(w.weekStart)} (${w.total} lượt)`, value: w.rate }))} />
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Buổi học sắp tới (7 ngày)</CardTitle>
                </CardHeader>
                <CardContent>
                  <SessionList sessions={d.upcomingSessions} emptyText="Không có buổi học sắp tới" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Lớp sắp khai giảng</CardTitle>
                </CardHeader>
                <CardContent>
                  {d.startingSoon.length ? (
                    <ul className="divide-y">
                      {d.startingSoon.map((c) => (
                        <li key={c.id} className="py-2.5">
                          <Link to={`/classes/${c.id}`} className="text-sm font-medium hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            Khai giảng {f.date(c.startDate)} · {c.teacher ?? 'Chưa có GV'} · {c.enrolled}/{c.capacity} học viên
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="Không có lớp sắp khai giảng" />
                  )}
                </CardContent>
              </Card>
              {d.role === 'ADMIN' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Học viên đang học theo khóa</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList data={d.enrollmentByCourse.map((e) => ({ label: e.course.code, title: e.course.name, value: e.count }))} />
                  </CardContent>
                </Card>
              ) : d.grades ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Kết quả học tập</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y text-sm">
                      {d.grades.classes.map((c) => (
                        <li key={c.classroom.id} className="flex justify-between py-2">
                          <span className="truncate">{c.classroom.name}</span>
                          <span className="tabular-nums">
                            {f.score(c.average)} <span className="text-muted-foreground">{c.band ?? ''}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {d.finance && d.role === 'ADMIN' ? (
              <div className="grid gap-5 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Doanh thu học phí theo tháng (đã thu)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ColumnChart ariaLabel="Doanh thu theo tháng" format={(n) => f.vndShort(n)} data={d.finance.revenueByMonth.map((m) => ({ label: `T${Number(m.month.slice(5))}`, title: `Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`, value: Number(m.amountVnd) }))} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Hoạt động gần đây</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {d.recentActivity.map((a) => (
                        <li key={a.id} className="text-sm">
                          <p className="line-clamp-2">{a.summary}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.actorName} · {f.relative(a.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        )}
      </QueryView>
    </>
  )
}
