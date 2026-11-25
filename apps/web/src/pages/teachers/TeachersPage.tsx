import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, KeyValue, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors, clean } from '@/lib/forms'
import * as f from '@/lib/format'
import type { Teacher } from '@/lib/types'

const schema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,32}$/, 'Mã gồm chữ in hoa, số, dấu -').or(z.literal('')),
  fullName: z.string().trim().min(2, 'Nhập họ tên').max(120),
  email: z.string().email('Email không hợp lệ').or(z.literal('')),
  phone: z.string().regex(/^[0-9+ .-]{8,20}$/, 'Số điện thoại không hợp lệ').or(z.literal('')),
  specialization: z.string().trim().min(2, 'Nhập chuyên môn').max(200),
  qualification: z.string().max(200),
  hiredAt: z.string(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'INACTIVE']),
  bio: z.string().max(2000),
})
type FormValues = z.infer<typeof schema>

function TeacherFormDialog({ open, onOpenChange, teacher }: { open: boolean; onOpenChange: (o: boolean) => void; teacher?: Teacher | null }) {
  const qc = useQueryClient()
  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  React.useEffect(() => {
    if (open) form.reset({ code: teacher?.code ?? '', fullName: teacher?.fullName ?? '', email: teacher?.email ?? '', phone: teacher?.phone ?? '', specialization: teacher?.specialization ?? '', qualification: teacher?.qualification ?? '', hiredAt: teacher?.hiredAt ?? '', status: teacher?.status ?? 'ACTIVE', bio: teacher?.bio ?? '' })
  }, [open, teacher, form])
  const save = useMutation({
    mutationFn: (v: FormValues) => (teacher ? api.patch<Teacher>(`/teachers/${teacher.id}`, clean(v)) : api.post<Teacher>('/teachers', clean(v))),
    onSuccess: () => {
      toast.success(teacher ? 'Đã cập nhật giáo viên' : 'Đã thêm giáo viên')
      qc.invalidateQueries({ queryKey: ['teachers'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={teacher ? `Sửa giáo viên ${teacher.code}` : 'Thêm giáo viên'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ và tên *" error={e.fullName?.message}>
          <Input {...form.register('fullName')} />
        </Field>
        <Field label="Mã giáo viên" error={e.code?.message} hint={teacher ? undefined : 'Để trống để tự sinh (GV###)'}>
          <Input {...form.register('code')} />
        </Field>
        <Field label="Chuyên môn *" error={e.specialization?.message} className="sm:col-span-2">
          <Input {...form.register('specialization')} placeholder="VD: IELTS, Academic Writing" />
        </Field>
        <Field label="Bằng cấp">
          <Input {...form.register('qualification')} />
        </Field>
        <Field label="Ngày vào làm">
          <Input type="date" {...form.register('hiredAt')} />
        </Field>
        <Field label="Email" error={e.email?.message}>
          <Input {...form.register('email')} />
        </Field>
        <Field label="Điện thoại" error={e.phone?.message}>
          <Input {...form.register('phone')} />
        </Field>
        <Field label="Trạng thái">
          <Select {...form.register('status')}>
            <option value="ACTIVE">Đang dạy</option>
            <option value="ON_LEAVE">Nghỉ phép</option>
            <option value="INACTIVE">Ngừng</option>
          </Select>
        </Field>
        <Field label="Giới thiệu" className="sm:col-span-2">
          <Textarea {...form.register('bio')} />
        </Field>
      </div>
    </Dialog>
  )
}

export function TeachersPage() {
  const p = usePrincipal()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status])
  const list = useQuery({ queryKey: ['teachers', { q, status, page }], queryFn: () => api.get<Page<Teacher>>('/teachers', { q, status, page, pageSize: 20 }) })
  const [editing, setEditing] = React.useState<Teacher | null | undefined>(undefined)
  return (
    <>
      <PageHeader
        title="Giáo viên"
        description="Đội ngũ giảng dạy, chuyên môn và phân công lớp"
        actions={
          p?.role === 'ADMIN' ? (
            <Button onClick={() => setEditing(null)}>
              <Plus /> Thêm giáo viên
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo tên, mã, chuyên môn" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang dạy</option>
            <option value="ON_LEAVE">Nghỉ phép</option>
            <option value="INACTIVE">Ngừng</option>
          </Select>
        </Toolbar>
        <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có giáo viên" />}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Mã</Th>
                    <Th>Họ tên</Th>
                    <Th>Chuyên môn</Th>
                    <Th>Liên hệ</Th>
                    <Th className="text-right">Lớp phụ trách</Th>
                    <Th>Trạng thái</Th>
                    {p?.role === 'ADMIN' ? <Th /> : null}
                  </tr>
                </THead>
                <TBody>
                  {d.items.map((t) => (
                    <Tr key={t.id}>
                      <Td className="font-mono text-xs">{t.code}</Td>
                      <Td>
                        <Link to={`/teachers/${t.id}`} className="font-medium hover:underline">
                          {t.fullName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{t.qualification}</div>
                      </Td>
                      <Td className="max-w-64 truncate">{t.specialization}</Td>
                      <Td className="text-xs text-muted-foreground">{t.phone ?? t.email ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{t.activeClasses ?? 0}</Td>
                      <Td>
                        <StatusBadge kind="teacher" value={t.status} />
                      </Td>
                      {p?.role === 'ADMIN' ? (
                        <Td className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(t)} aria-label="Sửa">
                            <Pencil />
                          </Button>
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pagination meta={d.meta} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Card>
      <TeacherFormDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} teacher={editing} />
    </>
  )
}

interface TeacherOverview {
  teacher: Teacher
  teachingStatus: string
  stats: { activeClasses: number; totalClasses: number; activeStudents: number; sessionsThisMonth: number; hoursThisMonth: number; upcomingSessions: number }
  classes: { id: string; code: string; name: string; status: string; startDate: string; endDate: string; course: { name: string }; room: string | null; capacity: number; activeStudents: number }[]
  upcomingSessions: { id: string; startsAt: string; endsAt: string; topic: string | null; classroom: { id: string; code: string; name: string }; room: string | null }[]
  students: { id: string; code: string; fullName: string; phone: string | null; classroom: { id: string; code: string } }[]
}

export function TeacherDetailPage() {
  const { id = '' } = useParams()
  const p = usePrincipal()
  const [editing, setEditing] = React.useState(false)
  const q = useQuery({ queryKey: ['teachers', id, 'overview'], queryFn: () => api.get<TeacherOverview>(`/teachers/${id}/overview`) })
  return (
    <QueryView query={q} rows={8}>
      {(d) => (
        <>
          <PageHeader
            title={d.teacher.fullName}
            description={
              <span className="flex items-center gap-2">
                <span className="font-mono">{d.teacher.code}</span> · {d.teacher.specialization} <StatusBadge kind="teacher" value={d.teachingStatus} />
              </span>
            }
            actions={
              p?.role === 'ADMIN' ? (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Chỉnh sửa
                </Button>
              ) : null
            }
          />
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Lớp đang dạy" value={d.stats.activeClasses} hint={`${d.stats.totalClasses} lớp tất cả`} />
            <StatCard label="Học viên" value={d.stats.activeStudents} />
            <StatCard label="Buổi đã dạy tháng này" value={d.stats.sessionsThisMonth} hint={`${d.stats.hoursThisMonth} giờ`} />
            <StatCard label="Buổi sắp tới (14 ngày)" value={d.stats.upcomingSessions} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Hồ sơ</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValue className="sm:grid-cols-1" items={[['Bằng cấp', d.teacher.qualification], ['Email', d.teacher.email], ['Điện thoại', d.teacher.phone], ['Ngày vào làm', f.date(d.teacher.hiredAt)], ['Giới thiệu', d.teacher.bio]]} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Lớp được phân công</CardTitle>
              </CardHeader>
              <CardContent>
                {d.classes.length ? (
                  <Table>
                    <THead>
                      <tr>
                        <Th>Lớp</Th>
                        <Th>Khóa học</Th>
                        <Th>Thời gian</Th>
                        <Th className="text-right">Sĩ số</Th>
                        <Th>Trạng thái</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {d.classes.map((c) => (
                        <Tr key={c.id}>
                          <Td>
                            <Link to={`/classes/${c.id}`} className="font-medium hover:underline">
                              {c.code}
                            </Link>
                          </Td>
                          <Td>{c.course.name}</Td>
                          <Td className="text-xs">
                            {f.date(c.startDate)} – {f.date(c.endDate)}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {c.activeStudents}/{c.capacity}
                          </Td>
                          <Td>
                            <StatusBadge kind="classroom" value={c.status} />
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState title="Chưa được phân công lớp" />
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Lịch dạy 14 ngày tới</CardTitle>
                <Link to={`/schedule?teacherId=${id}`} className="text-xs text-primary hover:underline">
                  Mở lịch dạy
                </Link>
              </CardHeader>
              <CardContent>
                {d.upcomingSessions.length ? (
                  <ul className="divide-y text-sm">
                    {d.upcomingSessions.map((s) => (
                      <li key={s.id} className="flex justify-between gap-3 py-2">
                        <span>
                          <span className="font-medium">{f.weekday(s.startsAt)}</span> {f.date(s.startsAt)} · {f.time(s.startsAt)}–{f.time(s.endsAt)}
                        </span>
                        <span className="text-muted-foreground">
                          {s.classroom.code} · {s.room ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Không có lịch dạy" />
                )}
              </CardContent>
            </Card>
            {d.students.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Học viên ({d.students.length})</CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto">
                  <ul className="divide-y text-sm">
                    {d.students.map((s) => (
                      <li key={`${s.id}-${s.classroom.id}`} className="flex justify-between py-1.5">
                        <Link to={`/students/${s.id}`} className="hover:underline">
                          {s.fullName}
                        </Link>
                        <span className="text-xs text-muted-foreground">{s.classroom.code}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
          <TeacherFormDialog open={editing} onOpenChange={setEditing} teacher={d.teacher} />
        </>
      )}
    </QueryView>
  )
}
