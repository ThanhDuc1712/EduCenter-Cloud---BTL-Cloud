import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Ban, HandCoins, Plus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, TabPanel, Tabs, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { ConfirmDialog, EmptyState, KeyValue, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { BarList, ColumnChart } from '@/components/charts'
import { api, newIdempotencyKey, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import { PAYMENT_METHOD } from '@/lib/labels'
import type { Invoice, Student } from '@/lib/types'

interface Summary {
  invoiceCount: number
  billedVnd: string
  collectedVnd: string
  outstandingVnd: string
  collectionRate: number
  overdue: { count: number; amountVnd: string }
  revenueByMonth: { month: string; amountVnd: string }[]
  byCourse: { course: { code: string; name: string } | null; billedVnd: string; collectedVnd: string }[]
}

interface InvoiceDetail extends Invoice {
  payments: { id: string; amountVnd: string; method: string; paidAt: string; note: string | null; receivedBy: string | null }[]
}

const paySchema = z.object({ amountVnd: z.string().regex(/^[1-9]\d{0,14}$/, 'Số tiền nguyên dương (VND)'), method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']), note: z.string().max(300) })
type PayValues = z.infer<typeof paySchema>

function PaymentDialog({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const p = usePrincipal()
  const q = useQuery({ queryKey: ['invoices', invoiceId], queryFn: () => api.get<InvoiceDetail>(`/invoices/${invoiceId}`), enabled: !!invoiceId })
  const form = useForm<PayValues>({ resolver: zodResolver(paySchema) })
  // One idempotency key per dialog opening: a double click / retry cannot create two payments.
  const keyRef = React.useRef(newIdempotencyKey())
  React.useEffect(() => {
    if (q.data) {
      keyRef.current = newIdempotencyKey()
      form.reset({ amountVnd: q.data.remainingVnd === '0' ? '' : q.data.remainingVnd, method: 'BANK_TRANSFER', note: '' })
    }
  }, [q.data, form])
  const pay = useMutation({
    mutationFn: (v: PayValues) => api.post<{ replayed: boolean; invoice: Invoice }>(`/invoices/${invoiceId}/payments`, { ...v, note: v.note || undefined }, { 'Idempotency-Key': keyRef.current }),
    onSuccess: (r) => {
      toast.success(r.replayed ? 'Thanh toán đã được ghi nhận trước đó (không tạo trùng)' : `Đã thu tiền · ${r.invoice.status === 'PAID' ? 'thanh toán đủ' : `còn nợ ${f.vnd(r.invoice.remainingVnd)}`}`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['tuition'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      onClose()
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const canPay = p?.role === 'ADMIN' && q.data && q.data.status !== 'CANCELLED' && q.data.remainingVnd !== '0'
  return (
    <Dialog
      open={!!invoiceId}
      onOpenChange={(o) => !o && onClose()}
      title={q.data ? `Khoản học phí ${q.data.code}` : 'Khoản học phí'}
      size="lg"
      footer={
        canPay ? (
          <Button onClick={form.handleSubmit((v) => pay.mutate(v))} disabled={pay.isPending}>
            {pay.isPending ? <Spinner /> : <HandCoins />} Ghi nhận thanh toán
          </Button>
        ) : undefined
      }
    >
      <QueryView query={q}>
        {(i) => (
          <div className="space-y-4">
            <KeyValue
              items={[
                ['Học viên', `${i.student.code} – ${i.student.fullName}`],
                ['Nội dung', i.description],
                ['Số tiền', f.vnd(i.amountVnd)],
                ['Giảm trừ', f.vnd(i.discountVnd)],
                ['Phải thu', f.vnd(i.totalDueVnd)],
                ['Đã thu', f.vnd(i.paidVnd)],
                ['Còn nợ', <span className="font-semibold">{f.vnd(i.remainingVnd)}</span>],
                ['Hạn nộp', `${f.date(i.dueDate)}${i.overdue ? ' (quá hạn)' : ''}`],
                ['Trạng thái', <StatusBadge kind="invoice" value={i.status} />],
              ]}
            />
            {canPay ? (
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
                <Field label="Số tiền thu (VND)" error={form.formState.errors.amountVnd?.message} hint="Cho phép thanh toán một phần">
                  <Input inputMode="numeric" {...form.register('amountVnd')} />
                </Field>
                <Field label="Hình thức">
                  <Select {...form.register('method')}>
                    {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ghi chú">
                  <Input {...form.register('note')} />
                </Field>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-sm font-medium">Lịch sử thanh toán</p>
              {i.payments.length ? (
                <Table>
                  <TBody>
                    {i.payments.map((x) => (
                      <Tr key={x.id}>
                        <Td>{f.dateTime(x.paidAt)}</Td>
                        <Td>{PAYMENT_METHOD[x.method]}</Td>
                        <Td className="text-right font-medium tabular-nums">{f.vnd(x.amountVnd)}</Td>
                        <Td className="text-muted-foreground">{x.receivedBy}</Td>
                        <Td className="text-muted-foreground">{x.note}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Chưa có thanh toán</p>
              )}
            </div>
          </div>
        )}
      </QueryView>
    </Dialog>
  )
}

const invoiceSchema = z.object({ studentId: z.string().min(1, 'Chọn học viên'), description: z.string().trim().min(2, 'Nhập nội dung').max(300), amountVnd: z.string().regex(/^[1-9]\d{0,14}$/, 'Số tiền nguyên dương'), discountVnd: z.string().regex(/^\d{0,15}$/, 'Số nguyên'), dueDate: z.string().min(1, 'Chọn hạn nộp') })
type InvoiceValues = z.infer<typeof invoiceSchema>

function InvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [sq, setSq] = React.useState('')
  const dq = useDebounced(sq)
  const students = useQuery({ queryKey: ['students', 'pick', dq], queryFn: () => api.get<Page<Student>>('/students', { q: dq, pageSize: 20 }), enabled: open })
  const form = useForm<InvoiceValues>({ resolver: zodResolver(invoiceSchema) })
  React.useEffect(() => {
    if (open) form.reset({ studentId: '', description: '', amountVnd: '', discountVnd: '', dueDate: f.todayYmd(14) })
  }, [open, form])
  const save = useMutation({
    mutationFn: (v: InvoiceValues) => api.post<Invoice>('/invoices', { ...v, discountVnd: v.discountVnd || undefined }),
    onSuccess: (i) => {
      toast.success(`Đã tạo khoản học phí ${i.code}`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['tuition'] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Tạo khoản học phí" footer={<Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>Tạo</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Học viên *" error={e.studentId?.message} className="sm:col-span-2">
          <SearchBox value={sq} onChange={setSq} placeholder="Tìm học viên" className="mb-2 sm:w-full" />
          <Select {...form.register('studentId')}>
            <option value="">— Chọn —</option>
            {students.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} – {s.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nội dung *" error={e.description?.message} className="sm:col-span-2">
          <Input {...form.register('description')} placeholder="VD: Phí tài liệu, phí thi thử…" />
        </Field>
        <Field label="Số tiền (VND) *" error={e.amountVnd?.message}>
          <Input inputMode="numeric" {...form.register('amountVnd')} />
        </Field>
        <Field label="Giảm trừ (VND)" error={e.discountVnd?.message}>
          <Input inputMode="numeric" {...form.register('discountVnd')} />
        </Field>
        <Field label="Hạn nộp *" error={e.dueDate?.message}>
          <Input type="date" {...form.register('dueDate')} />
        </Field>
      </div>
    </Dialog>
  )
}

interface PaymentRow {
  id: string
  amountVnd: string
  method: string
  paidAt: string
  receivedBy: string | null
  invoice: { code: string; description: string; student: { code: string; fullName: string } }
}

export function TuitionPage() {
  const p = usePrincipal()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState('invoices')
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [overdue, setOverdue] = React.useState(false)
  const [payPage, setPayPage] = React.useState(1)
  const [from, setFrom] = React.useState(f.todayYmd(-90))
  const [to, setTo] = React.useState(f.todayYmd())
  const [open, setOpen] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [cancelling, setCancelling] = React.useState<Invoice | null>(null)
  const q = useDebounced(search)
  const [page, setPage] = usePage([q, status, overdue])
  const summary = useQuery({ queryKey: ['tuition', 'summary'], queryFn: () => api.get<Summary>('/tuition/summary') })
  const invoices = useQuery({ queryKey: ['invoices', { q, status, overdue, page }], queryFn: () => api.get<Page<Invoice>>('/invoices', { q, status, overdue: overdue || undefined, page, pageSize: 20 }) })
  const payments = useQuery({ queryKey: ['payments', from, to, payPage], queryFn: () => api.get<Page<PaymentRow> & { totalVnd: string }>('/payments', { from, to, page: payPage, pageSize: 20 }), enabled: tab === 'payments' })
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/cancel`),
    onSuccess: () => {
      toast.success('Đã hủy khoản học phí')
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['tuition'] })
      setCancelling(null)
    },
    onError: (e) => applyServerErrors(e),
  })
  const isAdmin = p?.role === 'ADMIN'
  return (
    <>
      <PageHeader
        title="Học phí"
        description={isAdmin ? 'Khoản phải thu, thanh toán thủ công (VND), công nợ và doanh thu' : 'Học phí và lịch sử thanh toán của bạn'}
        actions={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Tạo khoản học phí
            </Button>
          ) : null
        }
      />
      <QueryView query={summary} rows={2}>
        {(s) => (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Phải thu" value={f.vndShort(s.billedVnd)} hint={f.vnd(s.billedVnd)} icon={Wallet} />
            <StatCard label="Đã thu" value={f.vndShort(s.collectedVnd)} hint={`Tỷ lệ thu ${s.collectionRate}%`} icon={HandCoins} tone="success" />
            <StatCard label="Công nợ" value={f.vndShort(s.outstandingVnd)} hint={f.vnd(s.outstandingVnd)} icon={AlertCircle} tone={s.outstandingVnd !== '0' ? 'warning' : 'default'} />
            <StatCard label="Quá hạn" value={s.overdue.count} hint={f.vnd(s.overdue.amountVnd)} icon={AlertCircle} tone={s.overdue.count ? 'danger' : 'default'} />
          </div>
        )}
      </QueryView>
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'invoices', label: 'Khoản học phí' }, { value: 'payments', label: 'Lịch sử thanh toán' }, ...(isAdmin ? [{ value: 'revenue', label: 'Thống kê doanh thu' }] : [])]}>
        <TabPanel value="invoices">
          <Card>
            <Toolbar>
              {isAdmin ? <SearchBox value={search} onChange={setSearch} placeholder="Mã khoản thu, tên/mã học viên" /> : null}
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
                <option value="">Mọi trạng thái</option>
                <option value="UNPAID">Chưa thanh toán</option>
                <option value="PARTIAL">Thanh toán một phần</option>
                <option value="PAID">Đã thanh toán</option>
                <option value="CANCELLED">Đã hủy</option>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Chỉ quá hạn
              </label>
            </Toolbar>
            <QueryView query={invoices} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Không có khoản học phí" />}>
              {(d) => (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Mã</Th>
                        <Th>Học viên</Th>
                        <Th>Nội dung</Th>
                        <Th>Hạn nộp</Th>
                        <Th className="text-right">Phải thu</Th>
                        <Th className="text-right">Đã thu</Th>
                        <Th className="text-right">Còn nợ</Th>
                        <Th>Trạng thái</Th>
                        <Th />
                      </tr>
                    </THead>
                    <TBody>
                      {d.items.map((i) => (
                        <Tr key={i.id}>
                          <Td>
                            <button className="font-mono text-xs hover:underline" onClick={() => setOpen(i.id)}>
                              {i.code}
                            </button>
                          </Td>
                          <Td>
                            {i.student.fullName}
                            <div className="font-mono text-xs text-muted-foreground">{i.student.code}</div>
                          </Td>
                          <Td className="max-w-60 truncate">{i.description}</Td>
                          <Td className={i.overdue ? 'font-medium text-destructive' : ''}>{f.date(i.dueDate)}</Td>
                          <Td className="text-right tabular-nums">{f.vnd(i.totalDueVnd)}</Td>
                          <Td className="text-right tabular-nums">{f.vnd(i.paidVnd)}</Td>
                          <Td className="text-right font-medium tabular-nums">{f.vnd(i.remainingVnd)}</Td>
                          <Td>
                            <StatusBadge kind="invoice" value={i.status} />
                          </Td>
                          <Td className="text-right whitespace-nowrap">
                            {isAdmin && i.status !== 'CANCELLED' && i.status !== 'PAID' ? (
                              <Button size="sm" variant="outline" onClick={() => setOpen(i.id)}>
                                <HandCoins /> Thu tiền
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setOpen(i.id)}>
                                Chi tiết
                              </Button>
                            )}
                            {isAdmin && i.paidVnd === '0' && i.status !== 'CANCELLED' ? (
                              <Button size="icon" variant="ghost" onClick={() => setCancelling(i)} aria-label="Hủy khoản">
                                <Ban />
                              </Button>
                            ) : null}
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
        </TabPanel>
        <TabPanel value="payments">
          <Card>
            <Toolbar>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="Từ ngày" />
              <span className="text-sm text-muted-foreground">→</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="Đến ngày" />
              {payments.data ? <span className="ml-auto text-sm">Tổng: <span className="font-semibold">{f.vnd(payments.data.totalVnd)}</span></span> : null}
            </Toolbar>
            <QueryView query={payments} isEmpty={(d) => d.items.length === 0}>
              {(d) => (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Thời gian</Th>
                        <Th>Khoản thu</Th>
                        <Th>Học viên</Th>
                        <Th>Hình thức</Th>
                        <Th className="text-right">Số tiền</Th>
                        <Th>Người thu</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {d.items.map((x) => (
                        <Tr key={x.id}>
                          <Td>{f.dateTime(x.paidAt)}</Td>
                          <Td className="font-mono text-xs">{x.invoice.code}</Td>
                          <Td>{x.invoice.student.fullName}</Td>
                          <Td>{PAYMENT_METHOD[x.method]}</Td>
                          <Td className="text-right font-medium tabular-nums">{f.vnd(x.amountVnd)}</Td>
                          <Td className="text-muted-foreground">{x.receivedBy}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                  <Pagination meta={d.meta} onPage={setPayPage} />
                </>
              )}
            </QueryView>
          </Card>
        </TabPanel>
        <TabPanel value="revenue">
          {summary.data ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Doanh thu đã thu theo tháng</CardTitle>
                </CardHeader>
                <CardContent>
                  <ColumnChart ariaLabel="Doanh thu theo tháng" format={(n) => f.vndShort(n)} data={summary.data.revenueByMonth.map((m) => ({ label: `T${Number(m.month.slice(5))}`, title: `Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`, value: Number(m.amountVnd) }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Đã thu theo khóa học</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList format={(n) => f.vndShort(n)} data={summary.data.byCourse.filter((c) => c.course).map((c) => ({ label: c.course!.code, title: c.course!.name, value: Number(c.collectedVnd) }))} />
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabPanel>
      </Tabs>
      <PaymentDialog invoiceId={open} onClose={() => setOpen(null)} />
      <InvoiceDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} title="Hủy khoản học phí" description={`Hủy khoản ${cancelling?.code}? Chỉ hủy được khi chưa có thanh toán.`} destructive pending={cancel.isPending} onConfirm={() => cancelling && cancel.mutate(cancelling.id)} />
    </>
  )
}
