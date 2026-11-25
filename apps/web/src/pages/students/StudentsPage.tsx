import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, Dialog, Field, Input, Select, Table, TBody, Td, Th, THead, Tr, Textarea } from '@/components/ui/primitives'
import { ConfirmDialog, EmptyState, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatusBadge, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors, clean } from '@/lib/forms'
import * as f from '@/lib/format'
import type { Classroom, Student } from '@/lib/types'

const phone = z.string().regex(/^[0-9+ .-]{8,20}$/, 'Số điện thoại không hợp lệ').or(z.literal(''))
const schema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,32}$/, 'Mã gồm chữ in hoa, số, dấu -').or(z.literal('')),
  fullName: z.string().trim().min(2, 'Nhập họ tên').max(120),
  email: z.string().email('Email không hợp lệ').or(z.literal('')),
  phone,
  dateOfBirth: z.string().or(z.literal('')),
  gender: z.enum(['', 'Nam', 'Nữ', 'Khác']),
  address: z.string().max(300),
  guardianName: z.string().max(120),
  guardianPhone: phone,
  note: z.string().max(1000),
})
type FormValues = z.infer<typeof schema>

export function StudentFormDialog({ open, onOpenChange, student }: { open: boolean; onOpenChange: (o: boolean) => void; student?: Student | null }) {
  const qc = useQueryClient()
  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  React.useEffect(() => {
    if (open)
      form.reset({
        code: student?.code ?? '',
        fullName: student?.fullName ?? '',
        email: student?.email ?? '',
        phone: student?.phone ?? '',
        dateOfBirth: student?.dateOfBirth ?? '',
        gender: (student?.gender as FormValues['gender']) ?? '',
        address: student?.address ?? '',
        guardianName: student?.guardianName ?? '',
        guardianPhone: student?.guardianPhone ?? '',
        note: student?.note ?? '',
      })
  }, [open, student, form])
  const save = useMutation({
    mutationFn: (v: FormValues) => (student ? api.patch<Student>(`/students/${student.id}`, clean(v)) : api.post<Student>('/students', clean(v))),
    onSuccess: (s) => {
      toast.success(student ? 'Đã cập nhật học viên' : `Đã thêm học viên ${s.code}`)
      qc.invalidateQueries({ queryKey: ['students'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={student ? `Sửa học viên ${student.code}` : 'Thêm học viên'}
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
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Field label="Họ và tên *" error={e.fullName?.message}>
          <Input {...form.register('fullName')} aria-invalid={!!e.fullName} />
        </Field>
        <Field label="Mã học viên" error={e.code?.message} hint={student ? undefined : 'Để trống để tự sinh (HV####)'}>
          <Input {...form.register('code')} />
        </Field>
        <Field label="Email" error={e.email?.message}>
          <Input type="email" {...form.register('email')} />
        </Field>
        <Field label="Điện thoại" error={e.phone?.message}>
          <Input {...form.register('phone')} />
        </Field>
        <Field label="Ngày sinh" error={e.dateOfBirth?.message}>
          <Input type="date" {...form.register('dateOfBirth')} />
        </Field>
        <Field label="Giới tính">
          <Select {...form.register('gender')}>
            <option value="">—</option>
            <option>Nam</option>
            <option>Nữ</option>
            <option>Khác</option>
          </Select>
        </Field>
        <Field label="Địa chỉ" className="sm:col-span-2">
          <Input {...form.register('address')} />
        </Field>
        <Field label="Phụ huynh / người giám hộ">
          <Input {...form.register('guardianName')} />
        </Field>
        <Field label="SĐT phụ huynh" error={e.guardianPhone?.message}>
          <Input {...form.register('guardianPhone')} />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea {...form.register('note')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function StudentsPage() {
  const p = usePrincipal()
  const isAdmin = p?.role === 'ADMIN'
  const qc = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [classroomId, setClassroomId] = React.useState('')
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status, classroomId])
  const list = useQuery({ queryKey: ['students', { q, status, classroomId, page }], queryFn: () => api.get<Page<Student>>('/students', { q, status, classroomId, page, pageSize: 20 }) })
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }) })
  const [editing, setEditing] = React.useState<Student | null | undefined>(undefined)
  const [archiving, setArchiving] = React.useState<Student | null>(null)
  const toggle = useMutation({
    mutationFn: (s: Student) => api.post<Student>(`/students/${s.id}/${s.status === 'ARCHIVED' ? 'restore' : 'archive'}`),
    onSuccess: (s) => {
      toast.success(s.status === 'ARCHIVED' ? 'Đã lưu trữ học viên' : 'Đã khôi phục học viên')
      qc.invalidateQueries({ queryKey: ['students'] })
      setArchiving(null)
    },
    onError: (e) => applyServerErrors(e),
  })

  return (
    <>
      <PageHeader
        title="Học viên"
        description={p?.role === 'TEACHER' ? 'Học viên thuộc các lớp bạn phụ trách' : 'Hồ sơ, tình trạng học tập và học phí của học viên'}
        actions={
          isAdmin ? (
            <Button onClick={() => setEditing(null)}>
              <Plus /> Thêm học viên
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo tên, mã, email, SĐT" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Lọc trạng thái">
            <option value="">Trạng thái: đang quản lý</option>
            <option value="ACTIVE">Đang học</option>
            <option value="INACTIVE">Tạm nghỉ</option>
            <option value="ARCHIVED">Lưu trữ</option>
          </Select>
          <Select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="w-auto max-w-60" aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>
            {classes.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} – {c.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có học viên phù hợp" description="Thử bỏ bớt bộ lọc hoặc thêm học viên mới." />}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Mã</Th>
                    <Th>Họ tên</Th>
                    <Th>Liên hệ</Th>
                    <Th>Ngày sinh</Th>
                    <Th className="text-right">Lớp đang học</Th>
                    <Th>Trạng thái</Th>
                    {isAdmin ? <Th className="text-right">Thao tác</Th> : null}
                  </tr>
                </THead>
                <TBody>
                  {d.items.map((s) => (
                    <Tr key={s.id}>
                      <Td className="font-mono text-xs">{s.code}</Td>
                      <Td>
                        <Link to={`/students/${s.id}`} className="font-medium hover:underline">
                          {s.fullName}
                        </Link>
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        <div>{s.phone ?? '—'}</div>
                        <div className="max-w-56 truncate">{s.email ?? ''}</div>
                      </Td>
                      <Td>{f.date(s.dateOfBirth)}</Td>
                      <Td className="text-right tabular-nums">{s.activeEnrollments ?? 0}</Td>
                      <Td>
                        <StatusBadge kind="student" value={s.status} />
                      </Td>
                      {isAdmin ? (
                        <Td className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(s)} aria-label="Sửa">
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setArchiving(s)} aria-label={s.status === 'ARCHIVED' ? 'Khôi phục' : 'Lưu trữ'}>
                            {s.status === 'ARCHIVED' ? <RotateCcw /> : <Archive />}
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
      <StudentFormDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} student={editing} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving?.status === 'ARCHIVED' ? 'Khôi phục học viên' : 'Lưu trữ học viên'}
        description={archiving?.status === 'ARCHIVED' ? `Khôi phục ${archiving?.fullName} về trạng thái đang học?` : `Lưu trữ ${archiving?.fullName}? Lịch sử điểm, điểm danh và học phí được giữ nguyên.`}
        destructive={archiving?.status !== 'ARCHIVED'}
        pending={toggle.isPending}
        onConfirm={() => archiving && toggle.mutate(archiving)}
      />
    </>
  )
}
