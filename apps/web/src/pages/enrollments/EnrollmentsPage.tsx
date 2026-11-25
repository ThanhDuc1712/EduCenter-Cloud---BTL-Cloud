import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Plus, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, Dialog, Field, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { ConfirmDialog, EmptyState, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatusBadge, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import type { Classroom, Student } from '@/lib/types'

interface Enrollment {
  id: string
  status: string
  enrolledAt: string
  endedAt: string | null
  note: string | null
  student: { id: string; code: string; fullName: string; phone: string | null; status: string }
  classroom: { id: string; code: string; name: string; status: string; capacity: number; course: { name: string } }
}

function EnrollDialog({ open, onOpenChange, defaultClassroomId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultClassroomId?: string }) {
  const qc = useQueryClient()
  const [classroomId, setClassroomId] = React.useState(defaultClassroomId ?? '')
  const [studentQ, setStudentQ] = React.useState('')
  const [studentId, setStudentId] = React.useState('')
  const [createInvoice, setCreateInvoice] = React.useState(true)
  const [note, setNote] = React.useState('')
  const dq = useDebounced(studentQ)
  const classes = useQuery({ queryKey: ['classrooms', 'open'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }), enabled: open })
  const students = useQuery({ queryKey: ['students', 'pick', dq], queryFn: () => api.get<Page<Student>>('/students', { q: dq, status: 'ACTIVE', pageSize: 20 }), enabled: open })
  const selected = classes.data?.items.find((c) => c.id === classroomId)
  const save = useMutation({
    mutationFn: () => api.post<{ invoice: { code: string } | null }>('/enrollments', { classroomId, studentId, note: note || undefined, createInvoice }),
    onSuccess: (r) => {
      toast.success(`Đã ghi danh${r.invoice ? ` · tạo khoản học phí ${r.invoice.code}` : ''}`)
      qc.invalidateQueries({ queryKey: ['enrollments'] })
      qc.invalidateQueries({ queryKey: ['classrooms'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Đăng ký học viên vào lớp"
      description="Hệ thống kiểm tra lớp còn chỗ (khóa hàng lớp) và chặn đăng ký trùng."
      footer={
        <Button disabled={!classroomId || !studentId || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner /> : null} Ghi danh
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Lớp học">
          <Select value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            <option value="">— Chọn lớp —</option>
            {classes.data?.items
              .filter((c) => c.status === 'ACTIVE' || c.status === 'PLANNED')
              .map((c) => (
                <option key={c.id} value={c.id} disabled={c.seatsLeft === 0}>
                  {c.code} – {c.name} ({c.activeStudents}/{c.capacity}){c.seatsLeft === 0 ? ' · ĐẦY' : ''}
                </option>
              ))}
          </Select>
        </Field>
        {selected ? (
          <p className="text-xs text-muted-foreground">
            Còn {selected.seatsLeft} chỗ · học phí {f.vnd(selected.tuitionVnd)} · {f.date(selected.startDate)} – {f.date(selected.endDate)}
          </p>
        ) : null}
        <Field label="Học viên">
          <SearchBox value={studentQ} onChange={setStudentQ} placeholder="Tìm học viên" className="mb-2 sm:w-full" />
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} size={6} className="h-auto">
            {students.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} – {s.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createInvoice} onChange={(e) => setCreateInvoice(e.target.checked)} /> Tạo khoản học phí cho lớp
        </label>
      </div>
    </Dialog>
  )
}

export function EnrollmentsPage() {
  const p = usePrincipal()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [classroomId, setClassroomId] = React.useState(params.get('classroomId') ?? '')
  const [open, setOpen] = React.useState(!!params.get('classroomId') && p?.role === 'ADMIN')
  const [cancelling, setCancelling] = React.useState<Enrollment | null>(null)
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status, classroomId])
  const list = useQuery({ queryKey: ['enrollments', { q, status, classroomId, page }], queryFn: () => api.get<Page<Enrollment>>('/enrollments', { q, status, classroomId, page, pageSize: 20 }) })
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }) })
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => (status === 'CANCELLED' ? api.post(`/enrollments/${id}/cancel`) : api.patch(`/enrollments/${id}`, { status })),
    onSuccess: () => {
      toast.success('Đã cập nhật đăng ký')
      qc.invalidateQueries({ queryKey: ['enrollments'] })
      setCancelling(null)
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <>
      <PageHeader
        title="Đăng ký học"
        description={p?.role === 'STUDENT' ? 'Các lớp bạn đã đăng ký' : 'Ghi danh học viên vào lớp, theo dõi tình trạng học'}
        actions={
          p?.role === 'ADMIN' ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Đăng ký mới
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Tìm học viên hoặc mã lớp" />
          <Select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="w-auto max-w-56" aria-label="Lớp">
            <option value="">Tất cả lớp</option>
            {classes.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang học</option>
            <option value="COMPLETED">Hoàn thành</option>
            <option value="DROPPED">Bỏ học</option>
            <option value="CANCELLED">Đã hủy</option>
          </Select>
        </Toolbar>
        <QueryView query={list} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có đăng ký" />}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Học viên</Th>
                    <Th>Lớp</Th>
                    <Th>Khóa học</Th>
                    <Th>Ngày đăng ký</Th>
                    <Th>Trạng thái</Th>
                    {p?.role === 'ADMIN' ? <Th className="text-right">Thao tác</Th> : null}
                  </tr>
                </THead>
                <TBody>
                  {d.items.map((e) => (
                    <Tr key={e.id}>
                      <Td>
                        {p?.role === 'STUDENT' ? e.student.fullName : <Link to={`/students/${e.student.id}`} className="font-medium hover:underline">{e.student.fullName}</Link>}
                        <div className="font-mono text-xs text-muted-foreground">{e.student.code}</div>
                      </Td>
                      <Td>
                        <Link to={`/classes/${e.classroom.id}`} className="hover:underline">
                          {e.classroom.code}
                        </Link>
                      </Td>
                      <Td>{e.classroom.course.name}</Td>
                      <Td>{f.date(e.enrolledAt)}</Td>
                      <Td>
                        <StatusBadge kind="enrollment" value={e.status} />
                      </Td>
                      {p?.role === 'ADMIN' ? (
                        <Td className="text-right whitespace-nowrap">
                          <Select className="inline-block h-8 w-36" value="" onChange={(ev) => ev.target.value && (ev.target.value === 'CANCELLED' ? setCancelling(e) : update.mutate({ id: e.id, status: ev.target.value }))} aria-label="Đổi trạng thái">
                            <option value="">Đổi trạng thái…</option>
                            {e.status !== 'ACTIVE' ? <option value="ACTIVE">Kích hoạt lại</option> : null}
                            {e.status === 'ACTIVE' ? <option value="COMPLETED">Hoàn thành</option> : null}
                            {e.status === 'ACTIVE' ? <option value="DROPPED">Bỏ học</option> : null}
                          </Select>
                          {e.status !== 'CANCELLED' ? (
                            <Button variant="ghost" size="icon" onClick={() => setCancelling(e)} aria-label="Hủy đăng ký">
                              <XCircle />
                            </Button>
                          ) : null}
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
      {/* Remounted on every opening so its form state starts fresh. */}
      <EnrollDialog key={open ? 'open' : 'closed'} open={open} onOpenChange={setOpen} defaultClassroomId={classroomId || undefined} />
      <ConfirmDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} title="Hủy đăng ký" description={`Hủy đăng ký của ${cancelling?.student.fullName} khỏi lớp ${cancelling?.classroom.code}? Khoản học phí chưa thanh toán của lớp sẽ bị hủy.`} destructive pending={update.isPending} onConfirm={() => cancelling && update.mutate({ id: cancelling.id, status: 'CANCELLED' })} />
    </>
  )
}
