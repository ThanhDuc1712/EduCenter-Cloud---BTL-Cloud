import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, Dialog, Select, Table, TabPanel, Tabs, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { KeyValue, PageHeader, QueryView, StatusBadge, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { usePrincipal } from '@/lib/context'
import * as f from '@/lib/format'
import type { Classroom, Room, Session, Teacher } from '@/lib/types'
import { cn } from '@/lib/utils'

type View = 'day' | 'week' | 'month'

function rangeFor(view: View, anchor: string): { from: string; to: string; days: string[] } {
  if (view === 'day') return { from: anchor, to: anchor, days: [anchor] }
  if (view === 'week') {
    const d = new Date(`${anchor}T00:00:00Z`).getUTCDay()
    const monday = f.addDays(anchor, -((d + 6) % 7))
    const days = Array.from({ length: 7 }, (_, i) => f.addDays(monday, i))
    return { from: days[0], to: days[6], days }
  }
  const first = `${anchor.slice(0, 7)}-01`
  const wd = new Date(`${first}T00:00:00Z`).getUTCDay()
  const start = f.addDays(first, -((wd + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => f.addDays(start, i))
  return { from: days[0], to: days[41], days }
}

const step: Record<View, number> = { day: 1, week: 7, month: 0 }

function shift(view: View, anchor: string, dir: 1 | -1): string {
  if (view !== 'month') return f.addDays(anchor, step[view] * dir)
  const d = new Date(`${anchor.slice(0, 7)}-15T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + dir)
  return d.toISOString().slice(0, 10)
}

function SessionChip({ s, onClick, compact }: { s: Session; onClick: () => void; compact?: boolean }) {
  return (
    <button onClick={onClick} className={cn('w-full rounded-md border-l-[3px] bg-primary/5 px-2 py-1 text-left text-xs hover:bg-primary/10', s.status === 'CANCELLED' ? 'border-l-destructive line-through opacity-60' : s.status === 'COMPLETED' ? 'border-l-emerald-500' : 'border-l-primary')}>
      <span className="font-medium tabular-nums">{f.time(s.startsAt)}</span> {s.classroom.code}
      {!compact ? (
        <span className="block truncate text-muted-foreground">
          {s.teacher?.fullName ?? '—'} · {s.room?.name ?? '—'}
        </span>
      ) : null}
    </button>
  )
}

interface ConflictScan {
  scannedSessions: number
  conflicts: { kind: 'TEACHER' | 'ROOM'; a: Session; b: Session }[]
}

export function SchedulePage() {
  const p = usePrincipal()
  const [params, setParams] = useSearchParams()
  const [view, setView] = React.useState<View>('week')
  const [anchor, setAnchor] = React.useState(f.todayYmd())
  const [tab, setTab] = React.useState('calendar')
  const [selected, setSelected] = React.useState<Session | null>(null)
  const classroomId = params.get('classroomId') ?? ''
  const teacherId = params.get('teacherId') ?? ''
  const roomId = params.get('roomId') ?? ''
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const r = rangeFor(view, anchor)
  const cal = useQuery({ queryKey: ['schedule', r.from, r.to, classroomId, teacherId, roomId], queryFn: () => api.get<{ items: Session[] }>('/schedule', { from: r.from, to: r.to, classroomId, teacherId, roomId, includeCancelled: true }) })
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }) })
  const teachers = useQuery({ queryKey: ['teachers', 'options-all'], queryFn: () => api.get<Page<Teacher>>('/teachers', { pageSize: 100 }), enabled: p?.role !== 'STUDENT' })
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<Room[]>('/rooms') })
  const conflicts = useQuery({ queryKey: ['schedule', 'conflicts'], queryFn: () => api.get<ConflictScan>('/schedule/conflicts', { from: f.todayYmd(-7), to: f.todayYmd(60) }), enabled: tab === 'conflicts' && p?.role === 'ADMIN' })
  const byDay = React.useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of cal.data?.items ?? []) {
      const d = f.localYmd(s.startsAt)
      m.set(d, [...(m.get(d) ?? []), s])
    }
    return m
  }, [cal.data])
  const today = f.todayYmd()
  const title = view === 'day' ? `${f.weekday(`${anchor}T05:00:00Z`)}, ${f.date(anchor)}` : view === 'week' ? `${f.date(r.from)} – ${f.date(r.to)}` : `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`

  return (
    <>
      <PageHeader title="Lịch học" description="Lịch học, lịch giảng dạy và lịch phòng học theo ngày / tuần / tháng" />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'calendar', label: 'Thời khóa biểu' }, ...(p?.role === 'ADMIN' ? [{ value: 'conflicts', label: 'Kiểm tra trùng lịch' }] : [])]}>
        <TabPanel value="calendar">
          <Card>
            <Toolbar>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" onClick={() => setAnchor(shift(view, anchor, -1))} aria-label="Trước">
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>
                  Hôm nay
                </Button>
                <Button variant="outline" size="icon" onClick={() => setAnchor(shift(view, anchor, 1))} aria-label="Sau">
                  <ChevronRight />
                </Button>
              </div>
              <span className="min-w-40 text-sm font-semibold">{title}</span>
              <div className="flex rounded-md border p-0.5">
                {(['day', 'week', 'month'] as View[]).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={cn('rounded px-3 py-1 text-sm', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {v === 'day' ? 'Ngày' : v === 'week' ? 'Tuần' : 'Tháng'}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Select value={classroomId} onChange={(e) => setFilter('classroomId', e.target.value)} className="w-auto max-w-48" aria-label="Lọc lớp">
                  <option value="">Tất cả lớp</option>
                  {classes.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </Select>
                {p?.role !== 'STUDENT' ? (
                  <Select value={teacherId} onChange={(e) => setFilter('teacherId', e.target.value)} className="w-auto max-w-48" aria-label="Lọc giáo viên">
                    <option value="">Tất cả giáo viên</option>
                    {teachers.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Select value={roomId} onChange={(e) => setFilter('roomId', e.target.value)} className="w-auto max-w-40" aria-label="Lọc phòng">
                  <option value="">Tất cả phòng</option>
                  {rooms.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Toolbar>
            <QueryView query={cal}>
              {() =>
                view === 'day' ? (
                  <div className="p-4">
                    {(byDay.get(anchor) ?? []).length ? (
                      <ul className="space-y-2">
                        {byDay.get(anchor)!.map((s) => (
                          <li key={s.id}>
                            <SessionChip s={s} onClick={() => setSelected(s)} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="py-10 text-center text-sm text-muted-foreground">Không có buổi học</p>
                    )}
                  </div>
                ) : view === 'week' ? (
                  <div className="grid grid-cols-1 divide-y md:grid-cols-7 md:divide-x md:divide-y-0">
                    {r.days.map((d) => (
                      <div key={d} className={cn('min-h-40 p-2', d === today && 'bg-primary/5')}>
                        <p className={cn('mb-2 text-xs font-medium', d === today ? 'text-primary' : 'text-muted-foreground')}>
                          {f.weekday(`${d}T05:00:00Z`)} {d.slice(8)}/{d.slice(5, 7)}
                        </p>
                        <div className="space-y-1.5">
                          {(byDay.get(d) ?? []).map((s) => (
                            <SessionChip key={s.id} s={s} onClick={() => setSelected(s)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-7 text-xs">
                    {f.WEEKDAYS.slice(1).map((w) => (
                      <div key={w} className="border-b px-2 py-1.5 font-medium text-muted-foreground">
                        {w}
                      </div>
                    ))}
                    {r.days.map((d) => {
                      const list = byDay.get(d) ?? []
                      const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
                      return (
                        <div key={d} className={cn('min-h-24 border-r border-b p-1', !inMonth && 'bg-muted/40 text-muted-foreground', d === today && 'bg-primary/5')}>
                          <button className="mb-1 font-medium hover:underline" onClick={() => (setAnchor(d), setView('day'))}>
                            {Number(d.slice(8))}
                          </button>
                          <div className="space-y-1">
                            {list.slice(0, 3).map((s) => (
                              <SessionChip key={s.id} s={s} compact onClick={() => setSelected(s)} />
                            ))}
                            {list.length > 3 ? <p className="text-muted-foreground">+{list.length - 3} buổi</p> : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              }
            </QueryView>
          </Card>
        </TabPanel>
        <TabPanel value="conflicts">
          <Card>
            <CardContent className="pt-4">
              <QueryView query={conflicts}>
                {(c) =>
                  c.conflicts.length === 0 ? (
                    <p className="flex items-center gap-2 py-6 text-sm text-emerald-700">
                      <CheckCircle2 className="size-5" /> Đã quét {c.scannedSessions} buổi (7 ngày trước → 60 ngày tới): không có trùng lịch giáo viên hoặc phòng học.
                    </p>
                  ) : (
                    <>
                      <p className="mb-3 flex items-center gap-2 text-sm text-destructive">
                        <AlertTriangle className="size-4" /> {c.conflicts.length} cặp buổi học bị trùng
                      </p>
                      <Table>
                        <THead>
                          <tr>
                            <Th>Loại</Th>
                            <Th>Buổi 1</Th>
                            <Th>Buổi 2</Th>
                          </tr>
                        </THead>
                        <TBody>
                          {c.conflicts.map((x, i) => (
                            <Tr key={i}>
                              <Td>{x.kind === 'TEACHER' ? `Giáo viên ${x.a.teacher?.fullName}` : `Phòng ${x.a.room?.name}`}</Td>
                              <Td>
                                {x.a.classroom.code} · {f.dateTime(x.a.startsAt)}
                              </Td>
                              <Td>
                                {x.b.classroom.code} · {f.dateTime(x.b.startsAt)}
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    </>
                  )
                }
              </QueryView>
            </CardContent>
          </Card>
        </TabPanel>
      </Tabs>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected ? `${selected.classroom.name}` : ''} description={selected ? `${f.weekday(selected.startsAt)}, ${f.date(selected.startsAt)} · ${f.time(selected.startsAt)}–${f.time(selected.endsAt)}` : undefined}>
        {selected ? (
          <>
            <KeyValue
              items={[
                ['Khóa học', selected.classroom.course?.name],
                ['Giáo viên', selected.teacher?.fullName],
                ['Phòng', selected.room?.name],
                ['Nội dung', selected.topic],
                ['Trạng thái', <StatusBadge kind="session" value={selected.status} />],
                ['Đã điểm danh', selected.attendanceRecorded ? `${selected.attendanceRecorded} học viên` : 'Chưa'],
              ]}
            />
            <div className="mt-4 flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/classes/${selected.classroom.id}`}>Mở lớp</Link>
              </Button>
              <Button asChild size="sm">
                <Link to={`/attendance/${selected.id}`}>
                  <ClipboardCheck /> Điểm danh
                </Link>
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  )
}
