import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { Bell, CheckCheck, Download, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent, Dialog, Field, Input, Select, Table, TBody, Td, Textarea, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, PageHeader, Pagination, QueryView, StatCard, Toolbar } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import { NOTIFICATION_TYPE } from '@/lib/labels'
import type { Classroom } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
}

function SendDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }), enabled: open })
  const form = useForm<{ type: string; title: string; body: string; audience: string; classroomId: string; link: string }>({ defaultValues: { type: 'SYSTEM', audience: 'ALL_STUDENTS', title: '', body: '', classroomId: '', link: '' } })
  const audience = form.watch('audience')
  const send = useMutation({
    mutationFn: (v: { type: string; title: string; body: string; audience: string; classroomId: string; link: string }) => api.post<{ sent: number }>('/notifications', { type: v.type, title: v.title, body: v.body, audience: v.audience, classroomId: v.audience === 'CLASS' ? v.classroomId : undefined, link: v.link || undefined }),
    onSuccess: (r) => {
      toast.success(`Đã gửi tới ${r.sent} người nhận`)
      qc.invalidateQueries({ queryKey: ['notifications'] })
      onOpenChange(false)
      form.reset()
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Gửi thông báo" footer={<Button onClick={form.handleSubmit((v) => send.mutate(v))} disabled={send.isPending}><Send /> Gửi</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loại">
          <Select {...form.register('type')}>
            {Object.entries(NOTIFICATION_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Người nhận">
          <Select {...form.register('audience')}>
            <option value="ALL_STUDENTS">Tất cả học viên</option>
            <option value="ALL_TEACHERS">Tất cả giáo viên</option>
            <option value="EVERYONE">Toàn trung tâm</option>
            <option value="CLASS">Một lớp</option>
          </Select>
        </Field>
        {audience === 'CLASS' ? (
          <Field label="Lớp" className="sm:col-span-2">
            <Select {...form.register('classroomId', { required: true })}>
              <option value="">— Chọn lớp —</option>
              {classes.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} – {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Tiêu đề" className="sm:col-span-2" error={form.formState.errors.title ? 'Nhập tiêu đề' : undefined}>
          <Input {...form.register('title', { required: true, minLength: 2 })} />
        </Field>
        <Field label="Nội dung" className="sm:col-span-2" error={form.formState.errors.body ? 'Nhập nội dung' : undefined}>
          <Textarea {...form.register('body', { required: true, minLength: 2 })} />
        </Field>
        <Field label="Liên kết trong ứng dụng (tùy chọn)" className="sm:col-span-2">
          <Input {...form.register('link')} placeholder="/schedule" />
        </Field>
      </div>
    </Dialog>
  )
}

export function NotificationsPage() {
  const p = usePrincipal()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [type, setType] = React.useState('')
  const [unread, setUnread] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [page, setPage] = usePage([type, unread])
  const q = useQuery({ queryKey: ['notifications', { type, unread, page }], queryFn: () => api.get<Page<Notification> & { unreadCount: number; unreadByType: Record<string, number> }>('/notifications', { type, unread: unread || undefined, page, pageSize: 20 }) })
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) })
  const readAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      toast.success(`Đã đánh dấu ${r.updated} thông báo là đã đọc`)
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  return (
    <>
      <PageHeader
        title="Thông báo"
        description="Thông báo lịch học, lớp học, học phí, tài liệu mới và kết quả học tập"
        actions={
          <>
            <Button variant="outline" onClick={() => readAll.mutate()} disabled={!q.data?.unreadCount}>
              <CheckCheck /> Đánh dấu tất cả đã đọc
            </Button>
            {p?.role === 'ADMIN' ? (
              <Button onClick={() => setSending(true)}>
                <Send /> Gửi thông báo
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <Toolbar>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={type === '' ? 'default' : 'outline'} onClick={() => setType('')}>
              Tất cả {q.data?.unreadCount ? <Badge tone="danger">{q.data.unreadCount}</Badge> : null}
            </Button>
            {Object.entries(NOTIFICATION_TYPE).map(([k, v]) => (
              <Button key={k} size="sm" variant={type === k ? 'default' : 'outline'} onClick={() => setType(k)}>
                {v} {q.data?.unreadByType[k] ? <Badge tone="danger">{q.data.unreadByType[k]}</Badge> : null}
              </Button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Chỉ chưa đọc
          </label>
        </Toolbar>
        <QueryView query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có thông báo" />}>
          {(d) => (
            <>
              <ul className="divide-y">
                {d.items.map((n) => (
                  <li key={n.id} className={cn('flex gap-3 px-4 py-3', !n.readAt && 'bg-primary/5')}>
                    <Bell className={cn('mt-0.5 size-4 shrink-0', n.readAt ? 'text-muted-foreground' : 'text-primary')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                        <Badge>{NOTIFICATION_TYPE[n.type]}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{f.relative(n.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {n.link ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (!n.readAt) read.mutate(n.id)
                            navigate(n.link!)
                          }}
                        >
                          Mở
                        </Button>
                      ) : null}
                      {!n.readAt ? (
                        <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>
                          Đã đọc
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination meta={d.meta} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Card>
      <SendDialog open={sending} onOpenChange={setSending} />
    </>
  )
}

// ─────────────────────────── Báo cáo ───────────────────────────

const REPORTS: { kind: string; label: string }[] = [
  { kind: 'students', label: 'Học viên' },
  { kind: 'teachers', label: 'Giáo viên' },
  { kind: 'courses', label: 'Khóa học' },
  { kind: 'classes', label: 'Lớp học' },
  { kind: 'attendance', label: 'Chuyên cần' },
  { kind: 'grades', label: 'Điểm' },
  { kind: 'revenue', label: 'Doanh thu' },
  { kind: 'debts', label: 'Học phí còn nợ' },
]

interface Report {
  title: string
  from: string
  to: string
  columns: { key: string; label: string; type?: string }[]
  rows: Record<string, string | number | null>[]
  summary: { label: string; value: string | number }[]
}

export function ReportsPage() {
  const [kind, setKind] = React.useState('students')
  const [from, setFrom] = React.useState(f.todayYmd(-89))
  const [to, setTo] = React.useState(f.todayYmd())
  const [page, setPage] = usePage([kind, from, to])
  const q = useQuery({ queryKey: ['reports', kind, from, to], queryFn: () => api.get<Report>(`/reports/${kind}`, { from, to }) })
  const per = 25
  const cell = (v: string | number | null, type?: string) => (v === null || v === undefined || v === '' ? '—' : type === 'money' ? f.vnd(String(v)) : type === 'percent' ? `${v}%` : type === 'date' ? f.date(String(v)) : String(v))
  return (
    <>
      <PageHeader
        title="Báo cáo & thống kê"
        description="Số liệu tổng hợp trực tiếp từ cơ sở dữ liệu, xuất CSV (UTF-8, mở được bằng Excel)"
        actions={
          <Button asChild variant="outline">
            <a href={`/api/v1/reports/${kind}?format=csv&from=${from}&to=${to}`} download>
              <Download /> Xuất CSV
            </a>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {REPORTS.map((r) => (
          <Button key={r.kind} size="sm" variant={kind === r.kind ? 'default' : 'outline'} onClick={() => setKind(r.kind)}>
            {r.label}
          </Button>
        ))}
      </div>
      <Card>
        <Toolbar>
          <span className="text-sm text-muted-foreground">Khoảng thời gian</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="Từ ngày" />
          <span>→</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="Đến ngày" />
        </Toolbar>
        <QueryView query={q} rows={8}>
          {(r) => (
            <CardContent className="pt-4">
              <h2 className="mb-3 font-semibold">{r.title}</h2>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {r.summary.map((s) => (
                  <StatCard key={s.label} label={s.label} value={<span className="text-lg">{s.value}</span>} />
                ))}
              </div>
              {r.rows.length ? (
                <div className="-mx-5">
                  <Table>
                    <THead>
                      <tr>
                        {r.columns.map((c) => (
                          <Th key={c.key} className={c.type && c.type !== 'text' && c.type !== 'date' ? 'text-right' : ''}>
                            {c.label}
                          </Th>
                        ))}
                      </tr>
                    </THead>
                    <TBody>
                      {r.rows.slice((page - 1) * per, page * per).map((row, i) => (
                        <Tr key={i}>
                          {r.columns.map((c) => (
                            <Td key={c.key} className={c.type && c.type !== 'text' && c.type !== 'date' ? 'text-right tabular-nums' : ''}>
                              {cell(row[c.key], c.type)}
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                  <Pagination meta={{ page, pageSize: per, total: r.rows.length, totalPages: Math.max(1, Math.ceil(r.rows.length / per)) }} onPage={setPage} />
                </div>
              ) : (
                <EmptyState title="Không có dữ liệu trong khoảng thời gian" />
              )}
            </CardContent>
          )}
        </QueryView>
      </Card>
    </>
  )
}
