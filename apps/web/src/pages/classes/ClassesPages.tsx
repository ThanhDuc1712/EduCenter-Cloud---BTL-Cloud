import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, CalendarPlus, CheckCircle2, ClipboardCheck, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, Dialog, Field, Input, Progress, Select, Table, TabPanel, Tabs, TBody, Td, Textarea, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, KeyValue, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { SegmentBar } from '@/components/charts'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors, clean } from '@/lib/forms'
import * as f from '@/lib/format'
import type { AttendanceCounts, Classroom, Course, Room, Session, Teacher } from '@/lib/types'
import { attendanceParts } from '@/lib/viz'
import { MaterialTable } from '../materials/MaterialTable'
import { Gradebook } from '../grades/GradesPage'

const slotSchema = z.object({ dayOfWeek: z.coerce.number<string>().int().min(1).max(7), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm'), durationMinutes: z.coerce.number<string>().int().min(15, '≥ 15 phút').max(600), roomId: z.string() })
const schema = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,32}$/, 'Mã gồm chữ in hoa, số, dấu -'),
    name: z.string().trim().min(2, 'Nhập tên lớp').max(200),
    courseId: z.string().min(1, 'Chọn khóa học'),
    teacherId: z.string(),
    roomId: z.string(),
    capacity: z.coerce.number<string>().int().min(1, '≥ 1').max(500),
    startDate: z.string().min(1, 'Chọn ngày bắt đầu'),
    endDate: z.string().min(1, 'Chọn ngày kết thúc'),
    status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
    tuitionVnd: z.string().regex(/^\d{0,15}$/, 'Số nguyên VND'),
    note: z.string().max(1000),
    slots: z.array(slotSchema).max(14),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'Ngày kết thúc phải sau ngày bắt đầu' })
type FormInput = z.input<typeof schema>
type FormValues = z.output<typeof schema>

interface Conflict {
  kind: 'TEACHER' | 'ROOM'
  startsAt: string
  withClassroom: { code: string; name: string } | null
}

function ClassFormDialog({ open, onOpenChange, classroom }: { open: boolean; onOpenChange: (o: boolean) => void; classroom?: Classroom | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const courses = useQuery({ queryKey: ['courses', 'options'], queryFn: () => api.get<Page<Course>>('/courses', { pageSize: 100, status: 'ACTIVE' }), enabled: open })
  const teachers = useQuery({ queryKey: ['teachers', 'options'], queryFn: () => api.get<Page<Teacher>>('/teachers', { pageSize: 100, status: 'ACTIVE' }), enabled: open })
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<Room[]>('/rooms'), enabled: open })
  const form = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(schema) })
  const slots = useFieldArray({ control: form.control, name: 'slots' })
  const [conflicts, setConflicts] = React.useState<Conflict[] | null>(null)
  React.useEffect(() => {
    if (!open) return
    form.reset({
      code: classroom?.code ?? '',
      name: classroom?.name ?? '',
      courseId: classroom?.course.id ?? '',
      teacherId: classroom?.teacher?.id ?? '',
      roomId: classroom?.room?.id ?? '',
      capacity: String(classroom?.capacity ?? 20),
      startDate: classroom?.startDate ?? f.todayYmd(7),
      endDate: classroom?.endDate ?? f.todayYmd(7 + 7 * 10),
      status: classroom?.status ?? 'PLANNED',
      tuitionVnd: classroom?.tuitionOverridden ? classroom.tuitionVnd : '',
      note: classroom?.note ?? '',
      slots: classroom ? [] : [{ dayOfWeek: '2', startTime: '18:00', durationMinutes: '120', roomId: '' }],
    })
  }, [open, classroom, form])

  const check = useMutation({
    mutationFn: (v: FormValues) => api.post<{ checked: number; conflicts: Conflict[] }>('/schedule/check', { teacherId: v.teacherId || undefined, roomId: v.roomId || undefined, startDate: v.startDate, endDate: v.endDate, slots: v.slots.map((s) => ({ ...s, roomId: s.roomId || undefined })) }),
    onSuccess: (r) => setConflicts(r.conflicts),
    onError: (e) => applyServerErrors(e),
  })
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = clean({ ...v, slots: undefined, teacherId: v.teacherId, roomId: v.roomId, tuitionVnd: v.tuitionVnd })
      if (classroom) {
        delete (body as Record<string, unknown>).courseId
        return api.patch<Classroom>(`/classrooms/${classroom.id}`, body)
      }
      return api.post<Classroom & { generatedSessions: number }>('/classrooms', { ...body, slots: v.slots.map((s) => ({ ...s, roomId: s.roomId || undefined })), generateSessions: true })
    },
    onSuccess: (c) => {
      toast.success(classroom ? 'Đã cập nhật lớp' : `Đã tạo lớp ${c.code} với ${(c as { generatedSessions?: number }).generatedSessions ?? 0} buổi học`)
      qc.invalidateQueries({ queryKey: ['classrooms'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
      onOpenChange(false)
      if (!classroom) navigate(`/classes/${c.id}`)
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setConflicts(null)
        onOpenChange(o)
      }}
      title={classroom ? `Sửa lớp ${classroom.code}` : 'Tạo lớp học'}
      size="lg"
      footer={
        <>
          {!classroom ? (
            <Button variant="outline" onClick={form.handleSubmit((v) => check.mutate(v))} disabled={check.isPending}>
              {check.isPending ? <Spinner /> : <AlertTriangle />} Kiểm tra trùng lịch
            </Button>
          ) : null}
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mã lớp *" error={e.code?.message}>
          <Input {...form.register('code')} placeholder="VD: IELTSF-K03" />
        </Field>
        <Field label="Tên lớp *" error={e.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <Field label="Khóa học *" error={e.courseId?.message}>
          <Select {...form.register('courseId')} disabled={!!classroom}>
            <option value="">— Chọn —</option>
            {classroom ? <option value={classroom.course.id}>{classroom.course.name}</option> : null}
            {courses.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} – {c.name} ({f.vnd(c.tuitionVnd)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Giáo viên phụ trách" error={e.teacherId?.message}>
          <Select {...form.register('teacherId')}>
            <option value="">— Chưa phân công —</option>
            {teachers.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName} · {t.specialization}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phòng mặc định" error={e.roomId?.message}>
          <Select {...form.register('roomId')}>
            <option value="">—</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.capacity} chỗ)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sức chứa *" error={e.capacity?.message}>
          <Input type="number" {...form.register('capacity')} />
        </Field>
        <Field label="Ngày bắt đầu *" error={e.startDate?.message}>
          <Input type="date" {...form.register('startDate')} />
        </Field>
        <Field label="Ngày kết thúc *" error={e.endDate?.message}>
          <Input type="date" {...form.register('endDate')} />
        </Field>
        <Field label="Trạng thái">
          <Select {...form.register('status')}>
            <option value="PLANNED">Sắp khai giảng</option>
            <option value="ACTIVE">Đang học</option>
            <option value="COMPLETED">Đã kết thúc</option>
            <option value="CANCELLED">Hủy lớp</option>
          </Select>
        </Field>
        <Field label="Học phí riêng (VND)" error={e.tuitionVnd?.message} hint="Để trống = theo học phí khóa học">
          <Input inputMode="numeric" {...form.register('tuitionVnd')} />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea {...form.register('note')} />
        </Field>
      </div>
      {!classroom ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Thời khóa biểu hàng tuần</p>
            <Button variant="outline" size="sm" onClick={() => slots.append({ dayOfWeek: '4', startTime: '18:00', durationMinutes: '120', roomId: '' })}>
              <Plus /> Thêm khung giờ
            </Button>
          </div>
          <SlotRows form={form} fields={slots.fields} remove={slots.remove} rooms={rooms.data ?? []} />
          <p className="mt-2 text-xs text-muted-foreground">Các buổi học được sinh tự động; hệ thống khóa lịch giáo viên và phòng để chống trùng lịch.</p>
        </div>
      ) : null}
      {conflicts ? (
        <div className={`mt-4 rounded-md p-3 text-sm ${conflicts.length ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {conflicts.length ? (
            <>
              <p className="font-medium">{conflicts.length} xung đột lịch</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {conflicts.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    {c.kind === 'TEACHER' ? 'Giáo viên' : 'Phòng'} bận lúc {f.dateTime(c.startsAt)} {c.withClassroom ? `(lớp ${c.withClassroom.code})` : '(trong lịch mới)'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex items-center gap-2">
              <CheckCircle2 className="size-4" /> Không có xung đột lịch
            </p>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}

type SlotForm = { slots: { dayOfWeek: string; startTime: string; durationMinutes: string; roomId: string }[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SlotRows({ form, fields, remove, rooms }: { form: any; fields: { id: string }[]; remove: (i: number) => void; rooms: Room[] }) {
  const reg = form.register as (name: `slots.${number}.${keyof SlotForm['slots'][number]}`) => object
  if (!fields.length) return <p className="text-sm text-muted-foreground">Chưa có khung giờ.</p>
  return (
    <div className="space-y-2">
      {fields.map((fl, i) => (
        <div key={fl.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
          <Select {...reg(`slots.${i}.dayOfWeek`)} aria-label="Thứ">
            {f.WEEKDAYS.slice(1).map((d, idx) => (
              <option key={d} value={String(idx + 1)}>
                {d}
              </option>
            ))}
          </Select>
          <Input type="time" {...reg(`slots.${i}.startTime`)} aria-label="Giờ bắt đầu" />
          <Input type="number" {...reg(`slots.${i}.durationMinutes`)} aria-label="Thời lượng (phút)" />
          <Select {...reg(`slots.${i}.roomId`)} aria-label="Phòng">
            <option value="">Phòng mặc định</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Xóa khung giờ">
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function ClassesPage() {
  const p = usePrincipal()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status])
  const list = useQuery({ queryKey: ['classrooms', { q, status, page }], queryFn: () => api.get<Page<Classroom>>('/classrooms', { q, status, page, pageSize: 20 }) })
  const [creating, setCreating] = React.useState(false)
  return (
    <>
      <PageHeader
        title="Lớp học"
        description="Lớp, giáo viên phụ trách, sĩ số, sức chứa và thời khóa biểu"
        actions={
          p?.role === 'ADMIN' ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Tạo lớp
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo tên hoặc mã lớp" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
            <option value="">Tất cả trạng thái</option>
            <option value="PLANNED">Sắp khai giảng</option>
            <option value="ACTIVE">Đang học</option>
            <option value="COMPLETED">Đã kết thúc</option>
            <option value="CANCELLED">Đã hủy</option>
          </Select>
        </Toolbar>
        <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có lớp học" />}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Lớp</Th>
                    <Th>Khóa học</Th>
                    <Th>Giáo viên</Th>
                    <Th>Thời khóa biểu</Th>
                    <Th>Thời gian</Th>
                    <Th>Sĩ số</Th>
                    <Th>Trạng thái</Th>
                  </tr>
                </THead>
                <TBody>
                  {d.items.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Link to={`/classes/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                      </Td>
                      <Td>{c.course.name}</Td>
                      <Td>{c.teacher?.fullName ?? <span className="text-muted-foreground">Chưa phân công</span>}</Td>
                      <Td className="text-xs">
                        {c.slots.map((s) => (
                          <div key={s.id}>
                            {f.WEEKDAYS[s.dayOfWeek]} {s.startTime} ({s.durationMinutes}′){s.room ? ` · ${s.room.name}` : ''}
                          </div>
                        ))}
                      </Td>
                      <Td className="text-xs">
                        {f.date(c.startDate)} – {f.date(c.endDate)}
                      </Td>
                      <Td className="min-w-28">
                        <div className="text-xs tabular-nums">
                          {c.activeStudents}/{c.capacity}
                        </div>
                        <Progress value={(c.activeStudents / c.capacity) * 100} className="mt-1 h-1.5" />
                      </Td>
                      <Td>
                        <StatusBadge kind="classroom" value={c.status} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pagination meta={d.meta} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Card>
      <ClassFormDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

// ─────────────────────────── Detail ───────────────────────────

interface RosterRow {
  enrollmentId: string
  status: string
  enrolledAt: string
  student: { id: string; code: string; fullName: string; phone: string | null; email: string | null }
}

function SessionDialog({ open, onOpenChange, classroom, session }: { open: boolean; onOpenChange: (o: boolean) => void; classroom: Classroom; session?: Session | null }) {
  const qc = useQueryClient()
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<Room[]>('/rooms'), enabled: open })
  const form = useForm<{ date: string; startTime: string; durationMinutes: string; roomId: string; topic: string; status: string }>()
  React.useEffect(() => {
    if (open)
      form.reset({
        date: session ? f.localYmd(session.startsAt) : f.todayYmd(1),
        startTime: session ? f.time(session.startsAt) : '18:00',
        durationMinutes: session ? String(Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000)) : '120',
        roomId: session?.room?.id ?? classroom.room?.id ?? '',
        topic: session?.topic ?? '',
        status: session?.status ?? 'SCHEDULED',
      })
  }, [open, session, classroom, form])
  const save = useMutation({
    mutationFn: (v: { date: string; startTime: string; durationMinutes: string; roomId: string; topic: string; status: string }) => {
      const body = clean({ ...v, durationMinutes: Number(v.durationMinutes) })
      if (session) return api.patch(`/sessions/${session.id}`, body)
      delete (body as Record<string, unknown>).status
      return api.post(`/classrooms/${classroom.id}/sessions`, body)
    },
    onSuccess: () => {
      toast.success(session ? 'Đã cập nhật buổi học' : 'Đã thêm buổi học')
      qc.invalidateQueries({ queryKey: ['classrooms', classroom.id] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={session ? 'Sửa buổi học' : 'Tạo buổi học'}
      description="Đổi giờ/phòng được kiểm tra trùng lịch giáo viên và phòng; học viên nhận thông báo."
      footer={
        <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
          {save.isPending ? <Spinner /> : null} Lưu
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ngày">
          <Input type="date" {...form.register('date', { required: true })} />
        </Field>
        <Field label="Giờ bắt đầu">
          <Input type="time" {...form.register('startTime', { required: true })} />
        </Field>
        <Field label="Thời lượng (phút)">
          <Input type="number" {...form.register('durationMinutes')} />
        </Field>
        <Field label="Phòng">
          <Select {...form.register('roomId')}>
            <option value="">—</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nội dung buổi học" className="sm:col-span-2">
          <Input {...form.register('topic')} />
        </Field>
        {session ? (
          <Field label="Trạng thái">
            <Select {...form.register('status')}>
              <option value="SCHEDULED">Đã lên lịch</option>
              <option value="COMPLETED">Đã học</option>
              <option value="CANCELLED">Hủy buổi</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  )
}

export function ClassDetailPage() {
  const { id = '' } = useParams()
  const p = usePrincipal()
  const navigate = useNavigate()
  const [tab, setTab] = React.useState('students')
  const [editing, setEditing] = React.useState(false)
  const [sessionDialog, setSessionDialog] = React.useState<Session | null | undefined>(undefined)
  const [sessionsPage, setSessionsPage] = React.useState(1)
  const q = useQuery({ queryKey: ['classrooms', id], queryFn: () => api.get<Classroom>(`/classrooms/${id}`) })
  const roster = useQuery({ queryKey: ['classrooms', id, 'roster'], queryFn: () => api.get<RosterRow[]>(`/classrooms/${id}/students`) })
  const sessions = useQuery({ queryKey: ['classrooms', id, 'sessions'], queryFn: () => api.get<Session[]>(`/classrooms/${id}/sessions`), enabled: tab === 'sessions' })
  const att = useQuery({ queryKey: ['classrooms', id, 'attendance'], queryFn: () => api.get<{ overall: AttendanceCounts; sessionsHeld: number; sessionsRecorded: number; students: (AttendanceCounts & { student: { id: string; code: string; fullName: string } })[] }>(`/classrooms/${id}/attendance-summary`), enabled: tab === 'attendance' })
  const canManage = p?.role === 'ADMIN' || (p?.role === 'TEACHER' && q.data?.teacher?.id === p.teacherId)
  return (
    <QueryView query={q} rows={8}>
      {(c) => (
        <>
          <PageHeader
            title={c.name}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{c.code}</span> · <Link to={`/courses/${c.course.id}`} className="hover:underline">{c.course.name}</Link> <StatusBadge kind="classroom" value={c.status} />
              </span>
            }
            actions={
              <>
                {canManage ? (
                  <>
                    <Button variant="outline" onClick={() => navigate(`/materials/upload?classroomId=${c.id}`)}>
                      <Upload /> Tài liệu lớp
                    </Button>
                    <Button variant="outline" onClick={() => setSessionDialog(null)}>
                      <CalendarPlus /> Thêm buổi
                    </Button>
                  </>
                ) : null}
                {p?.role === 'ADMIN' ? (
                  <>
                    <Button variant="outline" onClick={() => navigate(`/enrollments?classroomId=${c.id}`)}>
                      <Plus /> Đăng ký học viên
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      <Pencil /> Sửa
                    </Button>
                  </>
                ) : null}
              </>
            }
          />
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Sĩ số" value={`${c.activeStudents}/${c.capacity}`} hint={`Còn ${c.seatsLeft} chỗ`} />
            <StatCard label="Giáo viên" value={<span className="text-base">{c.teacher?.fullName ?? '—'}</span>} />
            <StatCard label="Phòng" value={<span className="text-base">{c.room?.name ?? '—'}</span>} />
            <StatCard label="Số buổi" value={c.sessionCount} hint={`${f.date(c.startDate)} – ${f.date(c.endDate)}`} />
            <StatCard label="Học phí" value={<span className="text-base">{f.vnd(c.tuitionVnd)}</span>} hint={c.tuitionOverridden ? 'Học phí riêng của lớp' : 'Theo khóa học'} />
          </div>
          <Card>
            <CardContent className="pt-4">
              <Tabs
                value={tab}
                onValueChange={setTab}
                tabs={[
                  { value: 'students', label: 'Học viên' },
                  { value: 'timetable', label: 'Thời khóa biểu' },
                  { value: 'sessions', label: 'Buổi học' },
                  { value: 'attendance', label: 'Chuyên cần' },
                  { value: 'grades', label: 'Điểm số' },
                  { value: 'materials', label: 'Tài liệu' },
                ]}
              >
                <TabPanel value="students">
                  <QueryView query={roster} isEmpty={(r) => r.length === 0} empty={<EmptyState title="Lớp chưa có học viên" />}>
                    {(r) => (
                      <Table>
                        <THead>
                          <tr>
                            <Th>Mã</Th>
                            <Th>Họ tên</Th>
                            <Th>Điện thoại</Th>
                            <Th>Ngày đăng ký</Th>
                            <Th>Trạng thái</Th>
                          </tr>
                        </THead>
                        <TBody>
                          {r.map((x) => (
                            <Tr key={x.enrollmentId}>
                              <Td className="font-mono text-xs">{x.student.code}</Td>
                              <Td>{p?.role === 'STUDENT' ? x.student.fullName : <Link to={`/students/${x.student.id}`} className="hover:underline">{x.student.fullName}</Link>}</Td>
                              <Td>{x.student.phone ?? '—'}</Td>
                              <Td>{f.date(x.enrolledAt)}</Td>
                              <Td>
                                <StatusBadge kind="enrollment" value={x.status} />
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    )}
                  </QueryView>
                </TabPanel>
                <TabPanel value="timetable">
                  {c.slots.length ? (
                    <Table>
                      <THead>
                        <tr>
                          <Th>Thứ</Th>
                          <Th>Giờ</Th>
                          <Th>Thời lượng</Th>
                          <Th>Phòng</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {c.slots.map((s) => (
                          <Tr key={s.id}>
                            <Td className="font-medium">{f.WEEKDAYS[s.dayOfWeek]}</Td>
                            <Td>{s.startTime}</Td>
                            <Td>{s.durationMinutes} phút</Td>
                            <Td>{s.room?.name ?? c.room?.name ?? '—'}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  ) : (
                    <EmptyState title="Chưa có thời khóa biểu" />
                  )}
                  <KeyValue className="mt-4" items={[['Ghi chú', c.note]]} />
                </TabPanel>
                <TabPanel value="sessions">
                  <QueryView query={sessions} isEmpty={(s) => s.length === 0} empty={<EmptyState title="Chưa có buổi học" />}>
                    {(list) => {
                      const per = 15
                      const pages = Math.max(1, Math.ceil(list.length / per))
                      const rows = list.slice((sessionsPage - 1) * per, sessionsPage * per)
                      return (
                        <>
                          <Table>
                            <THead>
                              <tr>
                                <Th>#</Th>
                                <Th>Ngày</Th>
                                <Th>Giờ</Th>
                                <Th>Phòng</Th>
                                <Th>Nội dung</Th>
                                <Th>Điểm danh</Th>
                                <Th>Trạng thái</Th>
                                <Th />
                              </tr>
                            </THead>
                            <TBody>
                              {rows.map((s, i) => (
                                <Tr key={s.id}>
                                  <Td className="text-muted-foreground">{(sessionsPage - 1) * per + i + 1}</Td>
                                  <Td>
                                    {f.weekday(s.startsAt)} {f.date(s.startsAt)}
                                  </Td>
                                  <Td>
                                    {f.time(s.startsAt)}–{f.time(s.endsAt)}
                                  </Td>
                                  <Td>{s.room?.name ?? '—'}</Td>
                                  <Td>{s.topic}</Td>
                                  <Td className="tabular-nums">{s.attendanceRecorded || '—'}</Td>
                                  <Td>
                                    <StatusBadge kind="session" value={s.status} />
                                  </Td>
                                  <Td className="text-right whitespace-nowrap">
                                    <Button variant="ghost" size="icon" onClick={() => navigate(`/attendance/${s.id}`)} aria-label="Điểm danh">
                                      <ClipboardCheck />
                                    </Button>
                                    {canManage ? (
                                      <Button variant="ghost" size="icon" onClick={() => setSessionDialog(s)} aria-label="Sửa buổi">
                                        <Pencil />
                                      </Button>
                                    ) : null}
                                  </Td>
                                </Tr>
                              ))}
                            </TBody>
                          </Table>
                          <Pagination meta={{ page: sessionsPage, totalPages: pages, total: list.length, pageSize: per }} onPage={setSessionsPage} />
                        </>
                      )
                    }}
                  </QueryView>
                </TabPanel>
                <TabPanel value="attendance">
                  <QueryView query={att}>
                    {(a) => (
                      <>
                        <p className="mb-2 text-sm text-muted-foreground">
                          Tỷ lệ chuyên cần <span className="font-semibold text-foreground">{a.overall.rate}%</span> · {a.sessionsRecorded}/{a.sessionsHeld} buổi đã điểm danh
                        </p>
                        <SegmentBar parts={attendanceParts(a.overall)} className="mb-4" />
                        <Table>
                          <THead>
                            <tr>
                              <Th>Học viên</Th>
                              <Th className="text-right">Có mặt</Th>
                              <Th className="text-right">Muộn</Th>
                              <Th className="text-right">Vắng</Th>
                              <Th className="text-right">Có phép</Th>
                              <Th className="text-right">Chuyên cần</Th>
                            </tr>
                          </THead>
                          <TBody>
                            {a.students.map((s) => (
                              <Tr key={s.student.id}>
                                <Td>{s.student.fullName}</Td>
                                <Td className="text-right tabular-nums">{s.present}</Td>
                                <Td className="text-right tabular-nums">{s.late}</Td>
                                <Td className="text-right tabular-nums">{s.absent}</Td>
                                <Td className="text-right tabular-nums">{s.excused}</Td>
                                <Td className={`text-right font-medium tabular-nums ${s.total && s.rate < 80 ? 'text-destructive' : ''}`}>{s.total ? `${s.rate}%` : '—'}</Td>
                              </Tr>
                            ))}
                          </TBody>
                        </Table>
                      </>
                    )}
                  </QueryView>
                </TabPanel>
                <TabPanel value="grades">
                  <Gradebook classroomId={c.id} />
                </TabPanel>
                <TabPanel value="materials">
                  <MaterialTable filter={{ classroomId: c.id }} compact />
                </TabPanel>
              </Tabs>
            </CardContent>
          </Card>
          <ClassFormDialog open={editing} onOpenChange={setEditing} classroom={c} />
          <SessionDialog open={sessionDialog !== undefined} onOpenChange={(o) => !o && setSessionDialog(undefined)} classroom={c} session={sessionDialog} />
        </>
      )}
    </QueryView>
  )
}
