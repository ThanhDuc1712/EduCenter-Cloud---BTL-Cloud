import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { CheckCheck, ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, PageHeader, Pagination, QueryView, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { SegmentBar } from '@/components/charts'
import { api, type Page } from '@/lib/api'
import { usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import type { AttendanceCounts, Classroom } from '@/lib/types'
import { attendanceParts } from '@/lib/viz'
import { cn } from '@/lib/utils'

type Status = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'
const OPTIONS: { value: Status; label: string; cls: string }[] = [
  { value: 'PRESENT', label: 'Có mặt', cls: 'data-[on=true]:bg-emerald-600 data-[on=true]:text-white' },
  { value: 'LATE', label: 'Muộn', cls: 'data-[on=true]:bg-amber-500 data-[on=true]:text-white' },
  { value: 'ABSENT', label: 'Vắng', cls: 'data-[on=true]:bg-red-600 data-[on=true]:text-white' },
  { value: 'EXCUSED', label: 'Có phép', cls: 'data-[on=true]:bg-blue-600 data-[on=true]:text-white' },
]

interface Sheet {
  session: { id: string; startsAt: string; endsAt: string; topic: string | null; status: string; room: string | null; teacher: string | null; classroom: { id: string; code: string; name: string } }
  canEdit: boolean
  summary: AttendanceCounts
  rows: { student: { id: string; code: string; fullName: string }; enrollmentStatus: string; status: Status | null; note: string | null }[]
}

export function AttendanceSessionPage() {
  const { sessionId = '' } = useParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['attendance', sessionId], queryFn: () => api.get<Sheet>(`/sessions/${sessionId}/attendance`) })
  type Mark = { status: Status | null; note: string }
  // Unsaved edits layered over the server sheet.
  const [edits, setEdits] = React.useState<Record<string, Mark>>({})
  const marks = React.useMemo<Record<string, Mark>>(() => ({ ...Object.fromEntries((q.data?.rows ?? []).map((r) => [r.student.id, { status: r.status, note: r.note ?? '' }])), ...edits }), [q.data, edits])
  const setMarks = (fn: (m: Record<string, Mark>) => Record<string, Mark>) => setEdits(fn(marks))
  const save = useMutation({
    mutationFn: () => api.put<{ saved: number; summary: AttendanceCounts }>(`/sessions/${sessionId}/attendance`, { records: Object.entries(marks).filter(([, v]) => v.status).map(([studentId, v]) => ({ studentId, status: v.status, note: v.note || undefined })) }),
    onSuccess: (r) => {
      toast.success(`Đã lưu điểm danh ${r.saved} học viên · chuyên cần ${r.summary.rate}%`)
      setEdits({})
      qc.invalidateQueries({ queryKey: ['attendance'] })
      qc.invalidateQueries({ queryKey: ['classrooms'] })
    },
    onError: (e) => applyServerErrors(e),
  })
  const missing = Object.values(marks).filter((m) => !m.status).length
  return (
    <QueryView query={q} rows={8}>
      {(d) => (
        <>
          <PageHeader
            title={`Điểm danh · ${d.session.classroom.name}`}
            description={`${f.weekday(d.session.startsAt)}, ${f.date(d.session.startsAt)} · ${f.time(d.session.startsAt)}–${f.time(d.session.endsAt)} · ${d.session.room ?? '—'} · GV ${d.session.teacher ?? '—'}`}
            actions={
              d.canEdit ? (
                <>
                  <Button variant="outline" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: v.status ?? 'PRESENT' }])))}>
                    <CheckCheck /> Đánh dấu còn lại có mặt
                  </Button>
                  <Button onClick={() => save.mutate()} disabled={save.isPending || Object.values(marks).every((m) => !m.status)}>
                    {save.isPending ? <Spinner /> : <ClipboardCheck />} Lưu điểm danh
                  </Button>
                </>
              ) : null
            }
          />
          <div className="mb-4 flex items-center gap-3">
            <StatusBadge kind="session" value={d.session.status} />
            {d.canEdit && missing ? <span className="text-sm text-amber-700">{missing} học viên chưa được điểm danh</span> : null}
          </div>
          <Card>
            {d.rows.length === 0 ? (
              <EmptyState title="Lớp chưa có học viên" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Học viên</Th>
                    <Th>Trạng thái</Th>
                    <Th>Ghi chú</Th>
                  </tr>
                </THead>
                <TBody>
                  {d.rows.map((r) => {
                    const m = marks[r.student.id] ?? { status: null, note: '' }
                    return (
                      <Tr key={r.student.id}>
                        <Td>
                          {r.student.fullName}
                          <div className="font-mono text-xs text-muted-foreground">{r.student.code}</div>
                        </Td>
                        <Td>
                          {d.canEdit ? (
                            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Điểm danh ${r.student.fullName}`}>
                              {OPTIONS.map((o) => (
                                <button key={o.value} role="radio" aria-checked={m.status === o.value} data-on={m.status === o.value} onClick={() => setMarks((s) => ({ ...s, [r.student.id]: { ...m, status: o.value } }))} className={cn('rounded-md border px-2.5 py-1 text-xs font-medium transition', o.cls)}>
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <StatusBadge kind="attendance" value={r.status} />
                          )}
                        </Td>
                        <Td>{d.canEdit ? <Input value={m.note} onChange={(e) => setMarks((s) => ({ ...s, [r.student.id]: { ...m, note: e.target.value } }))} className="h-8" aria-label="Ghi chú" /> : r.note}</Td>
                      </Tr>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>
          <Link to={`/classes/${d.session.classroom.id}`} className="mt-4 inline-block text-sm text-primary hover:underline">
            ← Về lớp {d.session.classroom.code}
          </Link>
        </>
      )}
    </QueryView>
  )
}

interface Pending {
  id: string
  startsAt: string
  endsAt: string
  topic: string | null
  classroom: { id: string; code: string; name: string }
  room: string | null
}

interface HistoryRow {
  id: string
  status: string
  note: string | null
  student: { id: string; code: string; fullName: string }
  session: { id: string; startsAt: string; classroom: { id: string; code: string } }
}

export function AttendancePage() {
  const p = usePrincipal()
  const navigate = useNavigate()
  const [classroomId, setClassroomId] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = usePage([classroomId, status])
  const pending = useQuery({ queryKey: ['attendance', 'pending'], queryFn: () => api.get<Pending[]>('/attendance/pending'), enabled: p?.role !== 'STUDENT' })
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }) })
  const summary = useQuery({ queryKey: ['attendance', 'summary', classroomId], queryFn: () => api.get<{ overall: AttendanceCounts; sessionsHeld: number; sessionsRecorded: number; students: (AttendanceCounts & { student: { id: string; fullName: string } })[] }>(`/classrooms/${classroomId}/attendance-summary`), enabled: !!classroomId })
  const mine = useQuery({ queryKey: ['attendance', 'mine', p?.studentId], queryFn: () => api.get<{ overall: AttendanceCounts; classes: (AttendanceCounts & { classroom: { id: string; code: string; name: string } })[] }>(`/students/${p!.studentId}/attendance-summary`), enabled: p?.role === 'STUDENT' && !!p.studentId })
  const history = useQuery({ queryKey: ['attendance', 'history', classroomId, status, page], queryFn: () => api.get<Page<HistoryRow>>('/attendance/history', { classroomId, status, page, pageSize: 20 }) })
  return (
    <>
      <PageHeader title="Điểm danh" description={p?.role === 'STUDENT' ? 'Lịch sử chuyên cần của bạn' : 'Điểm danh buổi học, lịch sử và tỷ lệ chuyên cần theo lớp, học viên'} />
      <div className="space-y-5">
        {p?.role !== 'STUDENT' ? (
          <Card>
            <CardHeader>
              <CardTitle>Buổi học cần điểm danh (30 ngày)</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryView query={pending} isEmpty={(d) => d.length === 0} empty={<p className="py-4 text-sm text-muted-foreground">Tất cả buổi học đã được điểm danh.</p>}>
                {(d) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {d.map((s) => (
                      <button key={s.id} onClick={() => navigate(`/attendance/${s.id}`)} className="rounded-lg border p-3 text-left hover:bg-muted/50">
                        <p className="text-sm font-medium">{s.classroom.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.weekday(s.startsAt)} {f.date(s.startsAt)} · {f.time(s.startsAt)} · {s.room ?? '—'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </QueryView>
            </CardContent>
          </Card>
        ) : (
          <QueryView query={mine}>
            {(d) => (
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Tỷ lệ chuyên cần chung</p>
                  <p className="mt-1 text-2xl font-semibold">{d.overall.rate}%</p>
                  <SegmentBar parts={attendanceParts(d.overall)} className="mt-3" />
                </Card>
                {d.classes.map((c) => (
                  <StatCard key={c.classroom.id} label={c.classroom.name} value={`${c.rate}%`} hint={`${c.present} có mặt · ${c.late} muộn · ${c.absent} vắng · ${c.excused} có phép`} />
                ))}
              </div>
            )}
          </QueryView>
        )}

        {p?.role !== 'STUDENT' && classroomId ? (
          <QueryView query={summary}>
            {(s) => (
              <Card>
                <CardHeader>
                  <CardTitle>Thống kê chuyên cần lớp · {s.overall.rate}%</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {s.sessionsRecorded}/{s.sessionsHeld} buổi đã điểm danh
                  </span>
                </CardHeader>
                <CardContent>
                  <SegmentBar parts={attendanceParts(s.overall)} className="mb-3" />
                  <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {s.students.map((x) => (
                      <div key={x.student.id} className="flex justify-between border-b py-1">
                        <span className="truncate">{x.student.fullName}</span>
                        <span className={cn('tabular-nums', x.total && x.rate < 80 && 'font-medium text-destructive')}>{x.total ? `${x.rate}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </QueryView>
        ) : null}

        <Card>
          <Toolbar>
            <span className="text-sm font-semibold">Lịch sử điểm danh</span>
            <Select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="ml-auto w-auto max-w-56" aria-label="Lớp">
              <option value="">Tất cả lớp</option>
              {classes.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Toolbar>
          <QueryView query={history} isEmpty={(d) => d.items.length === 0}>
            {(d) => (
              <>
                <Table>
                  <THead>
                    <tr>
                      <Th>Buổi học</Th>
                      <Th>Lớp</Th>
                      <Th>Học viên</Th>
                      <Th>Trạng thái</Th>
                      <Th>Ghi chú</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {d.items.map((r) => (
                      <Tr key={r.id}>
                        <Td>
                          <Link to={`/attendance/${r.session.id}`} className="hover:underline">
                            {f.dateTime(r.session.startsAt)}
                          </Link>
                        </Td>
                        <Td>{r.session.classroom.code}</Td>
                        <Td>{r.student.fullName}</Td>
                        <Td>
                          <StatusBadge kind="attendance" value={r.status} />
                        </Td>
                        <Td className="text-muted-foreground">{r.note ?? ''}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pagination meta={d.meta} onPage={setPage} />
              </>
            )}
          </QueryView>
        </Card>
      </div>
    </>
  )
}
