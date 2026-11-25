import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { PencilLine, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, PageHeader, QueryView, Spinner, StatCard } from '@/components/common'
import { BarList } from '@/components/charts'
import { api, ApiError, type Page } from '@/lib/api'
import { usePrincipal } from '@/lib/context'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import { ASSESSMENT_TYPE } from '@/lib/labels'
import type { Classroom } from '@/lib/types'

interface Assessment {
  id: string
  name: string
  type: string
  weight: number
  maxScore: number
  heldOn: string | null
}

interface GradebookData {
  classroom: { id: string; code: string; name: string }
  canEdit: boolean
  assessments: Assessment[]
  rows: { student: { id: string; code: string; fullName: string }; scores: { assessmentId: string; score: number | null }[]; average: number | null; band: string | null }[]
  bands: { label: string; minScore: number }[]
  stats: { students: number; graded: number; classAverage: number | null; highest: number | null; lowest: number | null; passRate: number | null; distribution: { label: string; count: number }[] }
}

interface Sheet {
  assessment: Assessment
  canEdit: boolean
  rows: { student: { id: string; code: string; fullName: string }; score: number | null; comment: string | null; version: number }[]
}

function GradeEntryDialog({ assessmentId, onClose }: { assessmentId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['assessments', assessmentId, 'grades'], queryFn: () => api.get<Sheet>(`/assessments/${assessmentId}/grades`), enabled: !!assessmentId })
  // User edits on top of the server values (no effect needed to seed state).
  const [edits, setEdits] = React.useState<Record<string, { score: string; comment: string }>>({})
  const values = React.useMemo(() => {
    const base = Object.fromEntries((q.data?.rows ?? []).map((r) => [r.student.id, { score: r.score === null ? '' : String(r.score), comment: r.comment ?? '' }]))
    return { ...base, ...edits }
  }, [q.data, edits])
  const setValues = (fn: (s: Record<string, { score: string; comment: string }>) => Record<string, { score: string; comment: string }>) => setEdits(fn(values))
  const close = () => {
    setEdits({})
    onClose()
  }
  const save = useMutation({
    mutationFn: () => {
      const sheet = q.data!
      const grades = sheet.rows
        .filter((r) => {
          const v = values[r.student.id]
          return v && ((v.score === '' ? null : Number(v.score)) !== r.score || (v.comment || null) !== r.comment)
        })
        .map((r) => ({ studentId: r.student.id, score: values[r.student.id].score === '' ? null : Number(values[r.student.id].score), comment: values[r.student.id].comment || undefined, version: r.version }))
      if (!grades.length) return Promise.resolve({ saved: 0 })
      return api.put<{ saved: number }>(`/assessments/${assessmentId}/grades`, { grades })
    },
    onSuccess: (r) => {
      toast.success(`Đã lưu ${r.saved} điểm`)
      qc.invalidateQueries({ queryKey: ['gradebook'] })
      qc.invalidateQueries({ queryKey: ['assessments', assessmentId] })
      close()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'GRADE_VERSION_CONFLICT') q.refetch()
      applyServerErrors(e)
    },
  })
  const invalid = q.data ? q.data.rows.some((r) => {
    const s = values[r.student.id]?.score
    return s !== undefined && s !== '' && (Number.isNaN(Number(s)) || Number(s) < 0 || Number(s) > q.data!.assessment.maxScore)
  }) : false
  return (
    <Dialog
      open={!!assessmentId}
      onOpenChange={(o) => !o && close()}
      title={q.data ? `Nhập điểm: ${q.data.assessment.name}` : 'Nhập điểm'}
      description={q.data ? `Thang điểm ${q.data.assessment.maxScore} · trọng số ${q.data.assessment.weight}% · lưu có kiểm tra phiên bản (chống ghi đè)` : undefined}
      size="lg"
      footer={
        q.data?.canEdit ? (
          <Button onClick={() => save.mutate()} disabled={save.isPending || invalid}>
            {save.isPending ? <Spinner /> : null} Lưu điểm
          </Button>
        ) : undefined
      }
    >
      <QueryView query={q} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <Table>
            <THead>
              <tr>
                <Th>Học viên</Th>
                <Th className="w-28">Điểm</Th>
                <Th>Nhận xét</Th>
              </tr>
            </THead>
            <TBody>
              {d.rows.map((r) => {
                const v = values[r.student.id] ?? { score: '', comment: '' }
                const bad = v.score !== '' && (Number.isNaN(Number(v.score)) || Number(v.score) < 0 || Number(v.score) > d.assessment.maxScore)
                return (
                  <Tr key={r.student.id}>
                    <Td>
                      {r.student.fullName}
                      <div className="font-mono text-xs text-muted-foreground">{r.student.code}</div>
                    </Td>
                    <Td>
                      <Input inputMode="decimal" value={v.score} disabled={!d.canEdit} aria-invalid={bad} onChange={(e) => setValues((s) => ({ ...s, [r.student.id]: { ...v, score: e.target.value.replace(',', '.') } }))} aria-label={`Điểm của ${r.student.fullName}`} />
                    </Td>
                    <Td>
                      <Input value={v.comment} disabled={!d.canEdit} onChange={(e) => setValues((s) => ({ ...s, [r.student.id]: { ...v, comment: e.target.value } }))} aria-label="Nhận xét" />
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </QueryView>
      {invalid ? <p className="mt-2 text-sm text-destructive">Có điểm nằm ngoài khoảng 0 – {q.data?.assessment.maxScore}</p> : null}
    </Dialog>
  )
}

function AssessmentDialog({ classroomId, assessment, open, onOpenChange }: { classroomId: string; assessment?: Assessment | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const form = useForm<{ name: string; type: string; weight: string; maxScore: string; heldOn: string }>()
  React.useEffect(() => {
    if (open) form.reset({ name: assessment?.name ?? '', type: assessment?.type ?? 'QUIZ', weight: String(assessment?.weight ?? 20), maxScore: String(assessment?.maxScore ?? 10), heldOn: assessment?.heldOn ?? f.todayYmd() })
  }, [open, assessment, form])
  const save = useMutation({
    mutationFn: (v: { name: string; type: string; weight: string; maxScore: string; heldOn: string }) => {
      const body = { name: v.name, type: v.type, weight: Number(v.weight), maxScore: Number(v.maxScore), heldOn: v.heldOn || undefined }
      return assessment ? api.patch(`/assessments/${assessment.id}`, body) : api.post(`/classrooms/${classroomId}/assessments`, body)
    },
    onSuccess: () => {
      toast.success(assessment ? 'Đã cập nhật bài kiểm tra' : 'Đã tạo bài kiểm tra')
      qc.invalidateQueries({ queryKey: ['gradebook', classroomId] })
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={assessment ? 'Sửa bài kiểm tra' : 'Tạo bài kiểm tra'}
      description="Tổng trọng số các bài của lớp không vượt quá 100%."
      footer={
        <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
          Lưu
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên bài" className="sm:col-span-2" error={form.formState.errors.name ? 'Nhập tên bài' : undefined}>
          <Input {...form.register('name', { required: true, minLength: 2 })} />
        </Field>
        <Field label="Loại">
          <Select {...form.register('type')}>
            {Object.entries(ASSESSMENT_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ngày kiểm tra">
          <Input type="date" {...form.register('heldOn')} />
        </Field>
        <Field label="Trọng số (%)">
          <Input type="number" min={0} max={100} {...form.register('weight')} />
        </Field>
        <Field label="Thang điểm">
          <Input type="number" min={1} max={100} step="0.5" {...form.register('maxScore')} />
        </Field>
      </div>
    </Dialog>
  )
}

/** Students × assessments matrix with weighted average and band (also embedded on the class page). */
export function Gradebook({ classroomId }: { classroomId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['gradebook', classroomId], queryFn: () => api.get<GradebookData>(`/classrooms/${classroomId}/gradebook`) })
  const [entry, setEntry] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<Assessment | null | undefined>(undefined)
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/assessments/${id}`),
    onSuccess: () => {
      toast.success('Đã xóa bài kiểm tra')
      qc.invalidateQueries({ queryKey: ['gradebook', classroomId] })
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <QueryView query={q}>
      {(g) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Điểm TB lớp" value={f.score(g.stats.classAverage)} hint={`${g.stats.graded}/${g.stats.students} học viên có điểm`} />
            <StatCard label="Cao nhất / thấp nhất" value={`${f.score(g.stats.highest)} / ${f.score(g.stats.lowest)}`} />
            <StatCard label="Tỷ lệ đạt (≥ 5)" value={g.stats.passRate === null ? '—' : `${g.stats.passRate}%`} />
            <Card className="p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Phân bố xếp loại</p>
              <BarList data={g.stats.distribution.map((d) => ({ label: d.label, value: d.count }))} />
            </Card>
          </div>
          {g.canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus /> Tạo bài kiểm tra
              </Button>
            </div>
          ) : null}
          {g.rows.length === 0 ? (
            <EmptyState title="Lớp chưa có học viên" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Học viên</Th>
                  {g.assessments.map((a) => (
                    <Th key={a.id} className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button className="hover:underline" onClick={() => setEntry(a.id)} title="Nhập / xem điểm">
                          {a.name}
                        </button>
                        {g.canEdit ? (
                          <>
                            <button onClick={() => setEditing(a)} aria-label="Sửa bài" className="text-muted-foreground hover:text-foreground">
                              <PencilLine className="size-3.5" />
                            </button>
                            <button onClick={() => confirm(`Xóa "${a.name}" và toàn bộ điểm của bài này?`) && del.mutate(a.id)} aria-label="Xóa bài" className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                      <div className="font-normal">
                        {a.weight}% · /{a.maxScore}
                      </div>
                    </Th>
                  ))}
                  <Th className="text-right">TB</Th>
                  <Th>Xếp loại</Th>
                </tr>
              </THead>
              <TBody>
                {g.rows.map((r) => (
                  <Tr key={r.student.id}>
                    <Td>
                      {r.student.fullName}
                      <div className="font-mono text-xs text-muted-foreground">{r.student.code}</div>
                    </Td>
                    {r.scores.map((s) => (
                      <Td key={s.assessmentId} className="text-center tabular-nums">
                        {f.score(s.score)}
                      </Td>
                    ))}
                    <Td className="text-right font-semibold tabular-nums">{f.score(r.average)}</Td>
                    <Td>{r.band ?? '—'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">Xếp loại: {g.bands.map((b) => `${b.label} ≥ ${b.minScore}`).join(' · ')} (thang 10, có trọng số)</p>
          <GradeEntryDialog assessmentId={entry} onClose={() => setEntry(null)} />
          <AssessmentDialog classroomId={classroomId} assessment={editing} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
        </div>
      )}
    </QueryView>
  )
}

function BandsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['grade-bands'], queryFn: () => api.get<{ label: string; minScore: number }[]>('/grade-bands'), enabled: open })
  const [edited, setEdited] = React.useState<{ label: string; minScore: string }[] | null>(null)
  const rows = edited ?? (q.data ?? []).map((b) => ({ label: b.label, minScore: String(b.minScore) }))
  const setRows = (fn: (r: { label: string; minScore: string }[]) => { label: string; minScore: string }[]) => setEdited(fn(rows))
  const save = useMutation({
    mutationFn: () => api.put('/grade-bands', { bands: rows.map((r) => ({ label: r.label, minScore: Number(r.minScore) })) }),
    onSuccess: () => {
      toast.success('Đã lưu thang xếp loại')
      qc.invalidateQueries({ queryKey: ['grade-bands'] })
      qc.invalidateQueries({ queryKey: ['gradebook'] })
      setEdited(null)
      onOpenChange(false)
    },
    onError: (e) => applyServerErrors(e),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : (setEdited(null), onOpenChange(false)))} title="Cấu hình xếp loại" description="Ngưỡng điểm tối thiểu (thang 10). Phải có một mức bắt đầu từ 0." footer={<Button onClick={() => save.mutate()} disabled={save.isPending}>Lưu</Button>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
            <Input value={r.label} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Tên xếp loại" />
            <Input type="number" step="0.25" min={0} max={10} value={r.minScore} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, minScore: e.target.value } : x)))} aria-label="Điểm tối thiểu" />
            <Button variant="ghost" size="icon" onClick={() => setRows((s) => s.filter((_, j) => j !== i))} aria-label="Xóa">
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setRows((s) => [...s, { label: '', minScore: '0' }])}>
          <Plus /> Thêm mức
        </Button>
      </div>
    </Dialog>
  )
}

interface StudentGrades {
  overallAverage: number | null
  classes: { classroom: { id: string; code: string; name: string }; average: number | null; band: string | null; assessments: (Assessment & { score: number | null; comment: string | null })[] }[]
}

export function GradesPage() {
  const p = usePrincipal()
  const classes = useQuery({ queryKey: ['classrooms', 'options'], queryFn: () => api.get<Page<Classroom>>('/classrooms', { pageSize: 100 }), enabled: p?.role !== 'STUDENT' })
  const mine = useQuery({ queryKey: ['students', p?.studentId, 'grades'], queryFn: () => api.get<StudentGrades>(`/students/${p!.studentId}/grades`), enabled: p?.role === 'STUDENT' && !!p.studentId })
  const [picked, setClassroomId] = React.useState('')
  const [bands, setBands] = React.useState(false)
  const items = classes.data?.items ?? []
  const classroomId = picked || (items.find((c) => c.status === 'ACTIVE') ?? items[0])?.id || ''

  if (p?.role === 'STUDENT') {
    return (
      <>
        <PageHeader title="Điểm số của tôi" description="Kết quả các bài kiểm tra và điểm trung bình có trọng số" />
        <QueryView query={mine} isEmpty={(d) => d.classes.length === 0}>
          {(d) => (
            <div className="space-y-4">
              <StatCard label="Điểm trung bình chung" value={f.score(d.overallAverage)} />
              {d.classes.map((c) => (
                <Card key={c.classroom.id}>
                  <CardHeader>
                    <CardTitle>{c.classroom.name}</CardTitle>
                    <span className="text-sm">
                      TB <span className="font-semibold tabular-nums">{f.score(c.average)}</span> {c.band ? `· ${c.band}` : ''}
                    </span>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <THead>
                        <tr>
                          <Th>Bài</Th>
                          <Th>Loại</Th>
                          <Th>Ngày</Th>
                          <Th>Trọng số</Th>
                          <Th className="text-right">Điểm</Th>
                          <Th>Nhận xét</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {c.assessments.map((a) => (
                          <Tr key={a.id}>
                            <Td>{a.name}</Td>
                            <Td>{ASSESSMENT_TYPE[a.type]}</Td>
                            <Td>{f.date(a.heldOn)}</Td>
                            <Td>{a.weight}%</Td>
                            <Td className="text-right font-medium tabular-nums">
                              {f.score(a.score)}/{a.maxScore}
                            </Td>
                            <Td className="text-muted-foreground">{a.comment ?? ''}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </QueryView>
      </>
    )
  }
  return (
    <>
      <PageHeader
        title="Điểm số"
        description="Bảng điểm theo lớp, nhập điểm, điểm trung bình có trọng số và xếp loại"
        actions={
          <>
            <Select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="w-72" aria-label="Chọn lớp">
              {classes.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} – {c.name}
                </option>
              ))}
            </Select>
            {p?.role === 'ADMIN' ? (
              <Button variant="outline" onClick={() => setBands(true)}>
                <Settings2 /> Xếp loại
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <CardContent className="pt-4">{classroomId ? <Gradebook classroomId={classroomId} /> : <EmptyState title="Chưa có lớp" />}</CardContent>
      </Card>
      <BandsDialog open={bands} onOpenChange={setBands} />
    </>
  )
}
