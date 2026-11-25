import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Table, TabPanel, Tabs, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, KeyValue, PageHeader, Pagination, QueryView, StatCard, StatusBadge } from '@/components/common'
import { SegmentBar } from '@/components/charts'
import { api, type Page } from '@/lib/api'
import { usePrincipal } from '@/lib/context'
import * as f from '@/lib/format'
import { ASSESSMENT_TYPE } from '@/lib/labels'
import type { AttendanceCounts, Student } from '@/lib/types'
import { attendanceParts } from '@/lib/viz'
import { StudentFormDialog } from './StudentsPage'

interface Overview {
  student: Student
  enrollments: { id: string; status: string; enrolledAt: string; classroom: { id: string; code: string; name: string; status: string; startDate: string; endDate: string; course: { name: string }; teacher: { fullName: string } | null } }[]
  upcomingSessions: { id: string; startsAt: string; endsAt: string; topic: string | null; classroom: { id: string; code: string; name: string }; room: string | null; teacher: string | null }[]
  grades: { overallAverage: number | null; classes: { classroom: { id: string; code: string; name: string }; average: number | null; band: string | null; assessments: { id: string; name: string; type: string; weight: number; maxScore: number; heldOn: string | null; score: number | null; comment: string | null }[] }[] }
  attendance: { overall: AttendanceCounts; classes: (AttendanceCounts & { classroom: { id: string; code: string; name: string } })[] }
  tuition: { billedVnd: string; paidVnd: string; outstandingVnd: string; invoices: { id: string; code: string; description: string; amountVnd: string; discountVnd: string; paidVnd: string; dueDate: string; status: string }[] } | null
}

interface HistoryRow {
  id: string
  status: string
  note: string | null
  session: { startsAt: string; topic: string | null; classroom: { code: string; name: string } }
}

function AttendanceHistory({ studentId }: { studentId: string }) {
  const [page, setPage] = React.useState(1)
  const q = useQuery({ queryKey: ['attendance-history', studentId, page], queryFn: () => api.get<Page<HistoryRow>>('/attendance/history', { studentId, page, pageSize: 15 }) })
  return (
    <QueryView query={q} isEmpty={(d) => d.items.length === 0}>
      {(d) => (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Ngày</Th>
                <Th>Lớp</Th>
                <Th>Nội dung</Th>
                <Th>Trạng thái</Th>
                <Th>Ghi chú</Th>
              </tr>
            </THead>
            <TBody>
              {d.items.map((r) => (
                <Tr key={r.id}>
                  <Td>{f.dateTime(r.session.startsAt)}</Td>
                  <Td>{r.session.classroom.code}</Td>
                  <Td>{r.session.topic ?? '—'}</Td>
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
  )
}

export function StudentDetailPage() {
  const { id = '' } = useParams()
  const p = usePrincipal()
  const [tab, setTab] = React.useState('classes')
  const [editing, setEditing] = React.useState(false)
  const q = useQuery({ queryKey: ['students', id, 'overview'], queryFn: () => api.get<Overview>(`/students/${id}/overview`) })
  return (
    <QueryView query={q} rows={8}>
      {(d) => (
        <>
          <PageHeader
            title={d.student.fullName}
            description={
              <span className="flex items-center gap-2">
                <span className="font-mono">{d.student.code}</span> <StatusBadge kind="student" value={d.student.status} />
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
            <StatCard label="Lớp đang học" value={d.enrollments.filter((e) => e.status === 'ACTIVE').length} />
            <StatCard label="Điểm trung bình" value={f.score(d.grades.overallAverage)} />
            <StatCard label="Chuyên cần" value={`${d.attendance.overall.rate}%`} hint={`${d.attendance.overall.total} buổi đã điểm danh`} />
            {d.tuition ? <StatCard label="Công nợ học phí" value={f.vnd(d.tuition.outstandingVnd)} tone={d.tuition.outstandingVnd !== '0' ? 'danger' : 'success'} hint={`Đã đóng ${f.vnd(d.tuition.paidVnd)}`} /> : null}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Thông tin học viên</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValue
                  className="sm:grid-cols-1"
                  items={[
                    ['Email', d.student.email],
                    ['Điện thoại', d.student.phone],
                    ['Ngày sinh', f.date(d.student.dateOfBirth)],
                    ['Giới tính', d.student.gender],
                    ['Địa chỉ', d.student.address],
                    ['Phụ huynh', d.student.guardianName ? `${d.student.guardianName} · ${d.student.guardianPhone ?? ''}` : null],
                    ['Ghi chú', d.student.note],
                  ]}
                />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardContent className="pt-4">
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  tabs={[
                    { value: 'classes', label: 'Khóa học đang tham gia' },
                    { value: 'schedule', label: 'Lịch học' },
                    { value: 'grades', label: 'Điểm' },
                    { value: 'attendance', label: 'Điểm danh' },
                    ...(d.tuition ? [{ value: 'tuition', label: 'Học phí' }] : []),
                  ]}
                >
                  <TabPanel value="classes">
                    {d.enrollments.length ? (
                      <Table>
                        <THead>
                          <tr>
                            <Th>Lớp</Th>
                            <Th>Khóa học</Th>
                            <Th>Giáo viên</Th>
                            <Th>Thời gian</Th>
                            <Th>Đăng ký</Th>
                          </tr>
                        </THead>
                        <TBody>
                          {d.enrollments.map((e) => (
                            <Tr key={e.id}>
                              <Td>
                                <Link className="font-medium hover:underline" to={`/classes/${e.classroom.id}`}>
                                  {e.classroom.code}
                                </Link>
                              </Td>
                              <Td>{e.classroom.course.name}</Td>
                              <Td>{e.classroom.teacher?.fullName ?? '—'}</Td>
                              <Td className="text-xs">
                                {f.date(e.classroom.startDate)} – {f.date(e.classroom.endDate)}
                              </Td>
                              <Td>
                                <StatusBadge kind="enrollment" value={e.status} />
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    ) : (
                      <EmptyState title="Chưa đăng ký lớp nào" />
                    )}
                  </TabPanel>
                  <TabPanel value="schedule">
                    {d.upcomingSessions.length ? (
                      <ul className="divide-y">
                        {d.upcomingSessions.map((s) => (
                          <li key={s.id} className="flex justify-between gap-3 py-2 text-sm">
                            <span>
                              <span className="font-medium">{f.weekday(s.startsAt)}</span> {f.date(s.startsAt)} · {f.time(s.startsAt)}–{f.time(s.endsAt)}
                            </span>
                            <span className="truncate text-muted-foreground">
                              {s.classroom.code} · {s.room ?? '—'} · {s.teacher ?? '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title="Không có buổi học trong 14 ngày tới" />
                    )}
                  </TabPanel>
                  <TabPanel value="grades">
                    {d.grades.classes.length ? (
                      <div className="space-y-4">
                        {d.grades.classes.map((c) => (
                          <div key={c.classroom.id}>
                            <p className="mb-1 text-sm font-medium">
                              {c.classroom.name} — TB <span className="tabular-nums">{f.score(c.average)}</span> {c.band ? `(${c.band})` : ''}
                            </p>
                            <Table>
                              <TBody>
                                {c.assessments.map((a) => (
                                  <Tr key={a.id}>
                                    <Td>{a.name}</Td>
                                    <Td className="text-muted-foreground">{ASSESSMENT_TYPE[a.type]}</Td>
                                    <Td className="text-muted-foreground">{a.weight}%</Td>
                                    <Td className="text-right font-medium tabular-nums">
                                      {f.score(a.score)} / {a.maxScore}
                                    </Td>
                                  </Tr>
                                ))}
                              </TBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="Chưa có điểm" />
                    )}
                  </TabPanel>
                  <TabPanel value="attendance">
                    <SegmentBar parts={attendanceParts(d.attendance.overall)} className="mb-4" />
                    <AttendanceHistory studentId={id} />
                  </TabPanel>
                  {d.tuition ? (
                    <TabPanel value="tuition">
                      <Table>
                        <THead>
                          <tr>
                            <Th>Mã</Th>
                            <Th>Nội dung</Th>
                            <Th>Hạn</Th>
                            <Th className="text-right">Phải thu</Th>
                            <Th className="text-right">Đã thu</Th>
                            <Th>Trạng thái</Th>
                          </tr>
                        </THead>
                        <TBody>
                          {d.tuition.invoices.map((i) => (
                            <Tr key={i.id}>
                              <Td className="font-mono text-xs">{i.code}</Td>
                              <Td>{i.description}</Td>
                              <Td>{f.date(i.dueDate)}</Td>
                              <Td className="text-right tabular-nums">{f.vnd(String(BigInt(i.amountVnd) - BigInt(i.discountVnd)))}</Td>
                              <Td className="text-right tabular-nums">{f.vnd(i.paidVnd)}</Td>
                              <Td>
                                <StatusBadge kind="invoice" value={i.status} />
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    </TabPanel>
                  ) : null}
                </Tabs>
              </CardContent>
            </Card>
          </div>
          <StudentFormDialog open={editing} onOpenChange={setEditing} student={d.student} />
        </>
      )}
    </QueryView>
  )
}
