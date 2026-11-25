import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Archive, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/ui/primitives'
import { ConfirmDialog, EmptyState, KeyValue, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors, clean } from '@/lib/forms'
import * as f from '@/lib/format'
import type { Course } from '@/lib/types'
import { MaterialTable } from '../materials/MaterialTable'

const schema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,32}$/, 'Mã gồm chữ in hoa, số, dấu -'),
  name: z.string().trim().min(2, 'Nhập tên khóa học').max(200),
  level: z.string().max(50),
  tuitionVnd: z.string().regex(/^\d{1,15}$/, 'Học phí là số nguyên (VND)'),
  durationHours: z.coerce.number<string>().int().min(1, 'Tối thiểu 1 giờ').max(2000),
  totalSessions: z.coerce.number<string>().int().min(1, 'Tối thiểu 1 buổi').max(500),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  description: z.string().max(2000),
  content: z.string().max(20000),
})
type FormInput = z.input<typeof schema>
type FormValues = z.output<typeof schema>

function CourseFormDialog({ open, onOpenChange, course }: { open: boolean; onOpenChange: (o: boolean) => void; course?: Course | null }) {
  const qc = useQueryClient()
  const form = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(schema) })
  React.useEffect(() => {
    if (open) form.reset({ code: course?.code ?? '', name: course?.name ?? '', level: course?.level ?? '', tuitionVnd: course?.tuitionVnd ?? '', durationHours: String(course?.durationHours ?? 24), totalSessions: String(course?.totalSessions ?? 12), status: course?.status ?? 'ACTIVE', description: course?.description ?? '', content: course?.content ?? '' })
  }, [open, course, form])
  const save = useMutation({
    mutationFn: (v: FormValues) => (course ? api.patch<Course>(`/courses/${course.id}`, clean(v)) : api.post<Course>('/courses', clean(v))),
    onSuccess: () => {
      toast.success(course ? 'Đã cập nhật khóa học' : 'Đã tạo khóa học')
      qc.invalidateQueries({ queryKey: ['courses'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={course ? `Sửa khóa học ${course.code}` : 'Tạo khóa học'}
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
        <Field label="Mã khóa học *" error={e.code?.message}>
          <Input {...form.register('code')} placeholder="VD: IELTS-F" />
        </Field>
        <Field label="Trình độ">
          <Input {...form.register('level')} />
        </Field>
        <Field label="Tên khóa học *" error={e.name?.message} className="sm:col-span-2">
          <Input {...form.register('name')} />
        </Field>
        <Field label="Học phí (VND) *" error={e.tuitionVnd?.message}>
          <Input inputMode="numeric" {...form.register('tuitionVnd')} />
        </Field>
        <Field label="Trạng thái">
          <Select {...form.register('status')}>
            <option value="ACTIVE">Đang mở</option>
            <option value="DRAFT">Nháp</option>
            <option value="ARCHIVED">Lưu trữ</option>
          </Select>
        </Field>
        <Field label="Thời lượng (giờ) *" error={e.durationHours?.message}>
          <Input type="number" {...form.register('durationHours')} />
        </Field>
        <Field label="Số buổi *" error={e.totalSessions?.message}>
          <Input type="number" {...form.register('totalSessions')} />
        </Field>
        <Field label="Mô tả" className="sm:col-span-2">
          <Textarea {...form.register('description')} />
        </Field>
        <Field label="Nội dung / đề cương" className="sm:col-span-2">
          <Textarea rows={6} {...form.register('content')} />
        </Field>
      </div>
    </Dialog>
  )
}

export function CoursesPage() {
  const p = usePrincipal()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status])
  const list = useQuery({ queryKey: ['courses', { q, status, page }], queryFn: () => api.get<Page<Course>>('/courses', { q, status, page, pageSize: 20 }) })
  const [editing, setEditing] = React.useState<Course | null | undefined>(undefined)
  return (
    <>
      <PageHeader
        title="Khóa học"
        description="Chương trình đào tạo, học phí và số lượng học viên"
        actions={
          p?.role === 'ADMIN' ? (
            <Button onClick={() => setEditing(null)}>
              <Plus /> Tạo khóa học
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo tên hoặc mã" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang mở</option>
            <option value="DRAFT">Nháp</option>
            <option value="ARCHIVED">Lưu trữ</option>
          </Select>
        </Toolbar>
        <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có khóa học" />}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Mã</Th>
                    <Th>Khóa học</Th>
                    <Th className="text-right">Học phí</Th>
                    <Th className="text-right">Thời lượng</Th>
                    <Th className="text-right">Lớp</Th>
                    <Th className="text-right">Học viên</Th>
                    <Th className="text-right">Tài liệu</Th>
                    <Th>Trạng thái</Th>
                    {p?.role === 'ADMIN' ? <Th /> : null}
                  </tr>
                </THead>
                <TBody>
                  {d.items.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-mono text-xs">{c.code}</Td>
                      <Td>
                        <Link to={`/courses/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{c.level}</div>
                      </Td>
                      <Td className="text-right tabular-nums">{f.vnd(c.tuitionVnd)}</Td>
                      <Td className="text-right text-xs">
                        {c.durationHours} giờ · {c.totalSessions} buổi
                      </Td>
                      <Td className="text-right tabular-nums">{c.classCount}</Td>
                      <Td className="text-right tabular-nums">{c.activeStudents}</Td>
                      <Td className="text-right tabular-nums">{c.materialCount}</Td>
                      <Td>
                        <StatusBadge kind="course" value={c.status} />
                      </Td>
                      {p?.role === 'ADMIN' ? (
                        <Td className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(c)} aria-label="Sửa">
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
      <CourseFormDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} course={editing} />
    </>
  )
}

type CourseDetail = Course & { classes: { id: string; code: string; name: string; status: string; startDate: string; endDate: string; capacity: number; teacher: { fullName: string } | null; activeStudents: number }[] }

export function CourseDetailPage() {
  const { id = '' } = useParams()
  const p = usePrincipal()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = React.useState(false)
  const [confirm, setConfirm] = React.useState<'archive' | 'delete' | null>(null)
  const q = useQuery({ queryKey: ['courses', id], queryFn: () => api.get<CourseDetail>(`/courses/${id}`) })
  const act = useMutation({
    mutationFn: (kind: 'archive' | 'delete') => (kind === 'archive' ? api.post(`/courses/${id}/archive`) : api.delete(`/courses/${id}`)),
    onSuccess: (_r, kind) => {
      toast.success(kind === 'archive' ? 'Đã lưu trữ khóa học' : 'Đã xóa khóa học')
      qc.invalidateQueries({ queryKey: ['courses'] })
      setConfirm(null)
      if (kind === 'delete') navigate('/courses')
    },
    onError: (e) => {
      setConfirm(null)
      applyServerErrors(e)
    },
  })
  return (
    <QueryView query={q} rows={8}>
      {(c) => (
        <>
          <PageHeader
            title={c.name}
            description={
              <span className="flex items-center gap-2">
                <span className="font-mono">{c.code}</span> <StatusBadge kind="course" value={c.status} />
              </span>
            }
            actions={
              <>
                {p?.role !== 'STUDENT' ? (
                  <Button variant="outline" onClick={() => navigate(`/materials/upload?courseId=${c.id}`)}>
                    <Upload /> Tải tài liệu
                  </Button>
                ) : null}
                {p?.role === 'ADMIN' ? (
                  <>
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      <Pencil /> Sửa
                    </Button>
                    <Button variant="outline" onClick={() => setConfirm('archive')} disabled={c.status === 'ARCHIVED'}>
                      <Archive /> Lưu trữ
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm('delete')}>
                      <Trash2 /> Xóa
                    </Button>
                  </>
                ) : null}
              </>
            }
          />
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Học phí" value={f.vnd(c.tuitionVnd)} />
            <StatCard label="Thời lượng" value={`${c.durationHours} giờ`} hint={`${c.totalSessions} buổi`} />
            <StatCard label="Số lớp" value={c.classes.length} />
            <StatCard label="Học viên đang học" value={c.activeStudents ?? 0} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Thông tin khóa học</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <KeyValue className="sm:grid-cols-1" items={[['Trình độ', c.level], ['Mô tả', c.description]]} />
                {c.content ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Nội dung</p>
                    <pre className="mt-1 font-sans text-sm whitespace-pre-wrap">{c.content}</pre>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Lớp học</CardTitle>
              </CardHeader>
              <CardContent>
                {c.classes.length ? (
                  <Table>
                    <THead>
                      <tr>
                        <Th>Lớp</Th>
                        <Th>Giáo viên</Th>
                        <Th>Thời gian</Th>
                        <Th className="text-right">Sĩ số</Th>
                        <Th>Trạng thái</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {c.classes.map((k) => (
                        <Tr key={k.id}>
                          <Td>
                            <Link to={`/classes/${k.id}`} className="font-medium hover:underline">
                              {k.code}
                            </Link>
                          </Td>
                          <Td>{k.teacher?.fullName ?? '—'}</Td>
                          <Td className="text-xs">
                            {f.date(k.startDate)} – {f.date(k.endDate)}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {k.activeStudents}/{k.capacity}
                          </Td>
                          <Td>
                            <StatusBadge kind="classroom" value={k.status} />
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState title="Chưa có lớp" />
                )}
              </CardContent>
            </Card>
          </div>
          <Card className="mt-5">
            <CardHeader>
              <CardTitle>Tài liệu khóa học</CardTitle>
            </CardHeader>
            <MaterialTable filter={{ courseId: c.id }} compact />
          </Card>
          <CourseFormDialog open={editing} onOpenChange={setEditing} course={c} />
          <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm === 'delete' ? 'Xóa khóa học' : 'Lưu trữ khóa học'} description={confirm === 'delete' ? 'Chỉ xóa được khóa học chưa có lớp, học phí hoặc tài liệu. Tiếp tục?' : 'Khóa học lưu trữ sẽ không mở được lớp mới.'} destructive pending={act.isPending} onConfirm={() => confirm && act.mutate(confirm)} />
        </>
      )}
    </QueryView>
  )
}
