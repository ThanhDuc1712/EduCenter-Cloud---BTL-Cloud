import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BookMarked, CheckCircle2, CircleDashed, Cloud, Download, Eye, FileUp, Pencil, RotateCcw, Trash2, Upload, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Progress, Select, Textarea } from '@/components/ui/primitives'
import { ConfirmDialog, EmptyState, KeyValue, PageHeader, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { api, errorMessage, uploadToTarget, type Page } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import { useAppContext, usePrincipal } from '@/lib/context'
import { applyServerErrors, clean } from '@/lib/forms'
import * as f from '@/lib/format'
import { CATEGORY, VISIBILITY } from '@/lib/labels'
import type { Classroom, Course, Material, Student, UploadTarget } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MaterialTable } from './MaterialTable'
import { isActive, useMaterialAccess } from './material-access'

// ─────────────────────────── Tài liệu ───────────────────────────

export function MaterialsPage() {
  const p = usePrincipal()
  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [visibility, setVisibility] = React.useState('')
  const [courseId, setCourseId] = React.useState('')
  const q = useDebounced(search)
  const courses = useQuery({ queryKey: ['courses', 'options'], queryFn: () => api.get<Page<Course>>('/courses', { pageSize: 100 }) })
  return (
    <>
      <PageHeader
        title="Tài liệu"
        description="Học liệu PDF được lưu ở Object Storage và xử lý tự động (quarantine → xử lý → published)"
        actions={
          p?.role !== 'STUDENT' ? (
            <Button onClick={() => navigate('/materials/upload')}>
              <Upload /> Upload tài liệu
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo tiêu đề, mô tả, tên tệp" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Phân loại">
            <option value="">Mọi phân loại</option>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-auto" aria-label="Phạm vi">
            <option value="">Mọi phạm vi</option>
            {Object.entries(VISIBILITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="w-auto max-w-56" aria-label="Khóa học">
            <option value="">Mọi khóa học</option>
            {courses.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {p?.role !== 'STUDENT' ? (
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'DELETED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : null}
        </Toolbar>
        <MaterialTable filter={{ q, status, category, visibility, courseId }} />
      </Card>
    </>
  )
}

// ─────────────────────────── Kho học liệu ───────────────────────────

export function LibraryPage() {
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('')
  const q = useDebounced(search)
  const list = useQuery({ queryKey: ['materials', 'library', q, category], queryFn: () => api.get<Page<Material>>('/materials', { q, category, status: 'READY', pageSize: 60 }) })
  const access = useMaterialAccess()
  return (
    <>
      <PageHeader title="Kho học liệu" description="Bài giảng, đề cương, bài tập, đề kiểm tra và tài liệu tham khảo đã sẵn sàng sử dụng" />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Tìm học liệu" />
        <Button variant={category === '' ? 'default' : 'outline'} size="sm" onClick={() => setCategory('')}>
          Tất cả
        </Button>
        {Object.entries(CATEGORY).map(([k, v]) => (
          <Button key={k} variant={category === k ? 'default' : 'outline'} size="sm" onClick={() => setCategory(k)}>
            {v}
          </Button>
        ))}
      </div>
      <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có học liệu phù hợp" />}>
        {(d) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.items.map((m) => (
              <Card key={m.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary">
                    <BookMarked className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/materials/${m.id}`} className="line-clamp-2 font-medium hover:underline">
                      {m.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {CATEGORY[m.category]} · {m.pageCount} trang · {f.bytes(m.sizeBytes)}
                    </p>
                  </div>
                </div>
                {m.description ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{m.description}</p> : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{VISIBILITY[m.visibility]}</Badge>
                  {m.course ? <Badge tone="info">{m.course.code}</Badge> : null}
                  {m.classroom ? <Badge tone="info">{m.classroom.code}</Badge> : null}
                </div>
                <div className="mt-auto flex gap-2 pt-3">
                  <Button size="sm" variant="outline" onClick={() => access.open(m, 'preview')}>
                    <Eye /> Xem trước
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => access.open(m, 'download')}>
                    <Download /> Tải xuống
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      {access.dialog}
    </>
  )
}

// ─────────────────────────── Upload ───────────────────────────

const uploadSchema = z
  .object({
    title: z.string().trim().min(2, 'Nhập tiêu đề').max(200),
    description: z.string().max(2000),
    category: z.enum(['LECTURE', 'SYLLABUS', 'EXERCISE', 'EXAM', 'REFERENCE', 'OTHER']),
    visibility: z.enum(['COURSE', 'CLASS', 'PERSONAL']),
    courseId: z.string(),
    classroomId: z.string(),
    studentId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === 'COURSE' && !v.courseId) ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'Chọn khóa học' })
    if (v.visibility === 'CLASS' && !v.classroomId) ctx.addIssue({ code: 'custom', path: ['classroomId'], message: 'Chọn lớp học' })
    if (v.visibility === 'PERSONAL' && !v.studentId) ctx.addIssue({ code: 'custom', path: ['studentId'], message: 'Chọn học viên được cấp quyền' })
  })
type UploadValues = z.infer<typeof uploadSchema>

type Step = 'idle' | 'policy' | 'uploading' | 'confirming' | 'processing' | 'done' | 'error'

export function UploadPage() {
  const ctx = useAppContext().data
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string>()
  const [step, setStep] = React.useState<Step>('idle')
  const [progress, setProgress] = React.useState(0)
  const [materialId, setMaterialId] = React.useState<string>()
  const [failure, setFailure] = React.useState<string>()
  const form = useForm<UploadValues>({ resolver: zodResolver(uploadSchema), defaultValues: { title: '', description: '', category: 'LECTURE', visibility: params.get('classroomId') ? 'CLASS' : 'COURSE', courseId: params.get('courseId') ?? '', classroomId: params.get('classroomId') ?? '', studentId: '' } })
  const visibility = form.watch('visibility')
  const courses = useQuery({ queryKey: ['courses', 'options'], queryFn: () => api.get<Page<Course>>('/courses', { pageSize: 100 }) })
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }) })
  const students = useQuery({ queryKey: ['students', 'options'], queryFn: () => api.get<Page<Student>>('/students', { pageSize: 100, status: 'ACTIVE' }), enabled: visibility === 'PERSONAL' })
  const status = useQuery({ queryKey: ['materials', materialId], queryFn: () => api.get<Material>(`/materials/${materialId}`), enabled: !!materialId, refetchInterval: (q) => (q.state.data && !isActive(q.state.data) ? false : 1500) })
  const maxMb = 10

  React.useEffect(() => {
    if (status.data && step === 'processing' && !isActive(status.data)) {
      setStep('done')
      qc.invalidateQueries({ queryKey: ['materials'] })
      if (status.data.status === 'READY') toast.success('Tài liệu đã sẵn sàng')
      else toast.error(`Tài liệu ${status.data.status}: ${status.data.rejectReason ?? ''}`)
    }
  }, [status.data, step, qc])

  const pick = (fl: File | undefined) => {
    setFileError(undefined)
    if (!fl) return setFile(null)
    if (!/\.pdf$/i.test(fl.name) || (fl.type && fl.type !== 'application/pdf')) return setFileError('Chỉ chấp nhận tệp PDF')
    if (fl.size > maxMb * 1024 * 1024) return setFileError(`Tệp vượt quá ${maxMb} MB`)
    setFile(fl)
    if (!form.getValues('title')) form.setValue('title', fl.name.replace(/\.pdf$/i, ''))
  }

  const submit = form.handleSubmit(async (v) => {
    if (!file) return setFileError('Chọn tệp PDF')
    setFailure(undefined)
    try {
      setStep('policy')
      const created = await api.post<{ material: Material; upload: UploadTarget }>('/materials', { ...clean(v), filename: file.name, contentType: 'application/pdf', size: file.size })
      setMaterialId(created.material.id)
      setStep('uploading')
      await uploadToTarget(created.upload, file, setProgress)
      setStep('confirming')
      await api.post(`/materials/${created.material.id}/complete`)
      setStep('processing')
    } catch (err) {
      setStep('error')
      setFailure(errorMessage(err))
      applyServerErrors(err, form.setError)
    }
  })

  const steps: { key: Step; label: string; detail: string }[] = [
    { key: 'policy', label: 'Tạo upload policy', detail: 'API (Azure) ký policy 5 phút, giới hạn kích thước + key cố định' },
    { key: 'uploading', label: `Tải trực tiếp lên ${ctx?.mode.storage === 'oss' ? 'OSS quarantine' : 'quarantine (LOCAL)'}`, detail: 'Tệp không đi qua API' },
    { key: 'confirming', label: 'Xác nhận upload', detail: 'API kiểm tra object tồn tại, ghi version' },
    { key: 'processing', label: ctx?.mode.processing === 'aliyun-fc' ? 'Function Compute xử lý' : 'Bộ xử lý LOCAL (MOCK FC)', detail: 'Kiểm tra PDF, đếm trang, tạo preview, callback HMAC' },
    { key: 'done', label: 'Kết quả', detail: 'READY / REJECTED / FAILED' },
  ]
  const order: Step[] = ['policy', 'uploading', 'confirming', 'processing', 'done']
  const currentIdx = order.indexOf(step)
  const e = form.formState.errors
  const busy = step === 'policy' || step === 'uploading' || step === 'confirming'

  return (
    <>
      <PageHeader title="Upload tài liệu" description={`PDF tối đa ${maxMb} MB. Chế độ: storage ${ctx?.mode.storage.toUpperCase()} · xử lý ${ctx?.mode.processing === 'aliyun-fc' ? 'Alibaba Function Compute' : 'LOCAL (MOCK)'}`} />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent className="space-y-4 pt-5">
            <label
              className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition hover:bg-muted/50', fileError && 'border-destructive')}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault()
                pick(ev.dataTransfer.files[0])
              }}
            >
              <FileUp className="size-8 text-muted-foreground" />
              {file ? (
                <span className="text-sm font-medium">
                  {file.name} · {f.bytes(file.size)}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Kéo thả tệp PDF vào đây hoặc bấm để chọn</span>
              )}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(ev) => pick(ev.target.files?.[0])} disabled={busy} />
            </label>
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tiêu đề *" error={e.title?.message} className="sm:col-span-2">
                <Input {...form.register('title')} />
              </Field>
              <Field label="Phân loại">
                <Select {...form.register('category')}>
                  {Object.entries(CATEGORY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Phạm vi chia sẻ">
                <Select {...form.register('visibility')}>
                  {Object.entries(VISIBILITY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              {visibility === 'COURSE' ? (
                <Field label="Khóa học *" error={e.courseId?.message} className="sm:col-span-2">
                  <Select {...form.register('courseId')}>
                    <option value="">— Chọn khóa học —</option>
                    {courses.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} – {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {visibility === 'CLASS' ? (
                <Field label="Lớp học *" error={e.classroomId?.message} className="sm:col-span-2">
                  <Select {...form.register('classroomId')}>
                    <option value="">— Chọn lớp —</option>
                    {classes.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} – {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {visibility === 'PERSONAL' ? (
                <Field label="Học viên được cấp quyền *" error={e.studentId?.message} className="sm:col-span-2">
                  <Select {...form.register('studentId')}>
                    <option value="">— Chọn học viên —</option>
                    {students.data?.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} – {s.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label="Mô tả" className="sm:col-span-2">
                <Textarea {...form.register('description')} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              {step === 'done' || step === 'error' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep('idle')
                    setFile(null)
                    setMaterialId(undefined)
                    setProgress(0)
                    form.reset()
                  }}
                >
                  Tải tệp khác
                </Button>
              ) : null}
              <Button onClick={submit} disabled={busy || step === 'processing' || step === 'done'}>
                {busy ? <Spinner /> : <Upload />} Tải lên
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Luồng xử lý xuyên Cloud</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {steps.map((s, i) => {
                const done = currentIdx > i || (step === 'done' && i === 4)
                const active = currentIdx === i && step !== 'done'
                const failed = step === 'error' && materialId && i === Math.max(0, order.indexOf('uploading'))
                return (
                  <li key={s.key} className="flex gap-3">
                    {done ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /> : active ? <Spinner className="mt-0.5 size-5 text-primary" /> : failed ? <XCircle className="mt-0.5 size-5 text-destructive" /> : <CircleDashed className="mt-0.5 size-5 text-muted-foreground" />}
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.detail}</p>
                      {s.key === 'uploading' && step === 'uploading' ? <Progress value={progress} className="mt-1.5 w-48" /> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
            {failure ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{failure}</p> : null}
            {status.data ? (
              <div className="mt-4 rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{status.data.title}</span>
                  <StatusBadge kind="material" value={status.data.status} />
                </div>
                {status.data.latestJob ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {status.data.latestJob.correlationId} · {status.data.latestJob.processor} {status.data.latestJob.durationMs ? `· ${f.ms(status.data.latestJob.durationMs)}` : ''}
                  </p>
                ) : null}
                {status.data.rejectReason ? <p className="mt-1 text-xs text-destructive">{status.data.rejectReason}</p> : null}
                <Button variant="link" className="mt-1 h-auto p-0" onClick={() => navigate(`/materials/${status.data!.id}`)}>
                  Xem chi tiết tài liệu
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ─────────────────────────── Chi tiết tài liệu ───────────────────────────

interface History {
  jobs: { id: string; attempt: number; processor: string; status: string; correlationId: string; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; callbackLatencyMs: number | null; errorCode: string | null; errorMessage: string | null }[]
  events: { id: string; type: string; source: string; fromStatus: string | null; toStatus: string | null; createdAt: string }[]
}

export function MaterialDetailPage() {
  const { id = '' } = useParams()
  const p = usePrincipal()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const q = useQuery({ queryKey: ['materials', id], queryFn: () => api.get<Material>(`/materials/${id}`), refetchInterval: (query) => (query.state.data && isActive(query.state.data) ? 1500 : false) })
  const history = useQuery({ queryKey: ['materials', id, 'history', q.data?.status], queryFn: () => api.get<History>(`/materials/${id}/history`), enabled: p?.role !== 'STUDENT' })
  const access = useMaterialAccess()
  const form = useForm<{ title: string; description: string; category: string }>()
  const retry = useMutation({
    mutationFn: () => api.post<Material>(`/materials/${id}/retry`),
    onSuccess: () => {
      toast.success('Đã gửi xử lý lại')
      qc.invalidateQueries({ queryKey: ['materials'] })
    },
    onError: (e) => applyServerErrors(e),
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/materials/${id}`),
    onSuccess: () => {
      toast.success('Đã xóa tài liệu và object trên storage')
      qc.invalidateQueries({ queryKey: ['materials'] })
      navigate('/materials')
    },
    onError: (e) => applyServerErrors(e),
  })
  const save = useMutation({
    mutationFn: (v: { title: string; description: string; category: string }) => api.patch(`/materials/${id}`, clean(v)),
    onSuccess: () => {
      toast.success('Đã cập nhật')
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['materials'] })
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <QueryView query={q} rows={8}>
      {(m) => (
        <>
          <PageHeader
            title={m.title}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="material" value={m.status} /> {CATEGORY[m.category]} · {VISIBILITY[m.visibility]}
                {m.latestJob ? <Badge tone={m.latestJob.processor === 'ALIYUN_FC' ? 'info' : 'violet'}>{m.latestJob.processor === 'ALIYUN_FC' ? 'Function Compute' : 'LOCAL MOCK'}</Badge> : null}
              </span>
            }
            actions={
              <>
                <Button variant="outline" disabled={m.status !== 'READY'} onClick={() => access.open(m, 'preview')}>
                  <Eye /> Xem trước
                </Button>
                <Button disabled={m.status !== 'READY'} onClick={() => access.open(m, 'download')}>
                  <Download /> Tải xuống
                </Button>
                {p?.role !== 'STUDENT' ? (
                  <>
                    {m.status === 'FAILED' || m.status === 'PROCESSING' ? (
                      <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
                        <RotateCcw /> Xử lý lại
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        form.reset({ title: m.title, description: m.description ?? '', category: m.category })
                        setEditing(true)
                      }}
                      aria-label="Sửa"
                    >
                      <Pencil />
                    </Button>
                    {m.status !== 'DELETED' ? (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Xóa">
                        <Trash2 />
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </>
            }
          />
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Số trang" value={m.pageCount ?? '—'} />
            <StatCard label="Kích thước" value={f.bytes(m.sizeBytes)} />
            <StatCard label="Lượt tải" value={m.downloadCount} />
            <StatCard label="Thời gian xử lý" value={f.ms(m.latestJob?.durationMs)} hint={m.latestJob ? `Lần ${m.latestJob.attempt}` : undefined} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Thông tin tài liệu</CardTitle>
              </CardHeader>
              <CardContent>
                {m.rejectReason ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{m.rejectReason}</p> : null}
                <KeyValue
                  items={[
                    ['Mô tả', m.description],
                    ['Tệp gốc', m.originalFilename],
                    ['Khóa học', m.course ? <Link to={`/courses/${m.course.id}`} className="hover:underline">{m.course.name}</Link> : null],
                    ['Lớp học', m.classroom ? <Link to={`/classes/${m.classroom.id}`} className="hover:underline">{m.classroom.code} – {m.classroom.name}</Link> : null],
                    ['Giáo viên', m.teacher?.fullName],
                    ['Học viên được cấp quyền', m.student ? `${m.student.code} – ${m.student.fullName}` : null],
                    ['Tiêu đề trong PDF', m.pdfTitle],
                    ['Tác giả PDF', m.pdfAuthor],
                    ['Người tải lên', m.uploadedBy],
                    ['Ngày tạo', f.dateTime(m.createdAt)],
                    ['Sẵn sàng lúc', f.dateTime(m.readyAt)],
                    ['Storage', `${m.storageProvider}${m.storageProvider === 'LOCAL' ? ' (MOCK OSS)' : ''}`],
                    ['Version nguồn', <span className="font-mono text-xs break-all">{m.sourceVersionId ?? '—'}</span>],
                    ['SHA-256', <span className="font-mono text-xs break-all">{m.checksumSha256 ?? '—'}</span>],
                  ]}
                />
              </CardContent>
            </Card>
            {history.data ? (
              <Card>
                <CardHeader>
                  <CardTitle>Lịch sử xử lý</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="relative space-y-3 border-l pl-4">
                    {history.data.events.map((ev) => (
                      <li key={ev.id} className="text-sm">
                        <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-primary" />
                        <p className="font-medium">{ev.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {ev.source} · {ev.fromStatus ?? '∅'} → {ev.toStatus ?? '∅'} · {f.dateTime(ev.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 space-y-2">
                    {history.data.jobs.map((j) => (
                      <div key={j.id} className="rounded-md border p-2 text-xs">
                        <div className="flex justify-between">
                          <span className="font-medium">Lần {j.attempt} · {j.processor}</span>
                          <StatusBadge kind="job" value={j.status} />
                        </div>
                        <p className="mt-1 font-mono text-muted-foreground">{j.correlationId}</p>
                        <p className="text-muted-foreground">
                          xử lý {f.ms(j.durationMs)} · callback {f.ms(j.callbackLatencyMs)}
                          {j.errorCode ? ` · ${j.errorCode}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
          {access.dialog}
          <Dialog
            open={editing}
            onOpenChange={setEditing}
            title="Sửa thông tin tài liệu"
            footer={
              <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
                Lưu
              </Button>
            }
          >
            <div className="space-y-3">
              <Field label="Tiêu đề">
                <Input {...form.register('title', { required: true, minLength: 2 })} />
              </Field>
              <Field label="Phân loại">
                <Select {...form.register('category')}>
                  {Object.entries(CATEGORY).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mô tả">
                <Textarea {...form.register('description')} />
              </Field>
            </div>
          </Dialog>
          <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Xóa tài liệu" description="Tài liệu chuyển sang DELETED và các object (nguồn, bản xử lý, preview, kết quả) bị xóa khỏi storage. Phiên bản cũ do versioning/lifecycle của bucket quản lý." destructive pending={del.isPending} onConfirm={() => del.mutate()} />
        </>
      )}
    </QueryView>
  )
}

// ─────────────────────────── Processing Center ───────────────────────────

export function ProcessingCenterPage() {
  const ctx = useAppContext().data
  const q = useQuery({ queryKey: ['materials', 'processing-center'], queryFn: () => api.get<Page<Material> & { countsByStatus: Record<string, number> }>('/materials', { pageSize: 1 }), refetchInterval: 5000 })
  const counts = q.data?.countsByStatus ?? {}
  const [status, setStatus] = React.useState('PROCESSING')
  return (
    <>
      <PageHeader title="Processing Center" description={`Theo dõi trạng thái xử lý tài liệu · bộ xử lý: ${ctx?.mode.processing === 'aliyun-fc' ? 'Alibaba Function Compute' : 'LOCAL (MOCK — không phải cloud)'}`} actions={<Badge tone={ctx?.mode.processing === 'aliyun-fc' ? 'info' : 'violet'}><Cloud className="size-3" /> {ctx?.mode.processing === 'aliyun-fc' ? 'CLOUD' : 'MOCK'}</Badge>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {['UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="text-left">
            <StatCard label={s} value={counts[s] ?? 0} tone={s === 'READY' ? 'success' : s === 'FAILED' || s === 'REJECTED' ? 'danger' : 'default'} hint={status === s ? 'đang lọc' : undefined} />
          </button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tài liệu: {status}</CardTitle>
        </CardHeader>
        <MaterialTable filter={{ status }} />
      </Card>
    </>
  )
}
