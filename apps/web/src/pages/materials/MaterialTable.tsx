import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Download, Eye, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Table, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, Pagination, QueryView, Spinner, StatusBadge } from '@/components/common'
import { api, type Page } from '@/lib/api'
import { usePage } from '@/lib/hooks'
import * as f from '@/lib/format'
import { CATEGORY, VISIBILITY } from '@/lib/labels'
import type { Material } from '@/lib/types'
import { isActive, useMaterialAccess } from './material-access'

export interface MaterialFilter {
  q?: string
  status?: string
  category?: string
  visibility?: string
  courseId?: string
  classroomId?: string
}

/** Material list used on the materials page, course/class pages and the library. Polls while processing. */
export function MaterialTable({ filter, compact }: { filter: MaterialFilter; compact?: boolean }) {
  const key = JSON.stringify(filter)
  const [page, setPage] = usePage([key])
  const q = useQuery({
    queryKey: ['materials', filter, page],
    queryFn: () => api.get<Page<Material> & { countsByStatus: Record<string, number> }>('/materials', { ...filter, page, pageSize: compact ? 10 : 20 }),
    refetchInterval: (query) => (query.state.data?.items.some(isActive) ? 2000 : false),
  })
  const access = useMaterialAccess()
  return (
    <>
      <QueryView query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Chưa có tài liệu" description="Tài liệu PDF được tải lên sẽ được xử lý tự động và hiển thị tại đây khi sẵn sàng." />}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Tài liệu</Th>
                  <Th>Phân loại</Th>
                  {!compact ? <Th>Liên kết</Th> : null}
                  <Th className="text-right">Kích thước</Th>
                  <Th>Trạng thái</Th>
                  <Th>Cập nhật</Th>
                  <Th className="text-right">Thao tác</Th>
                </tr>
              </THead>
              <TBody>
                {d.items.map((m) => (
                  <Tr key={m.id}>
                    <Td>
                      <Link to={`/materials/${m.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="max-w-72 truncate">{m.title}</span>
                      </Link>
                      <div className="pl-6 text-xs text-muted-foreground">
                        {m.originalFilename}
                        {m.pageCount ? ` · ${m.pageCount} trang` : ''}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-sm">{CATEGORY[m.category]}</div>
                      <div className="text-xs text-muted-foreground">{VISIBILITY[m.visibility]}</div>
                    </Td>
                    {!compact ? <Td className="text-xs">{m.classroom ? `Lớp ${m.classroom.code}` : m.course ? m.course.name : m.student ? `HV ${m.student.code}` : '—'}</Td> : null}
                    <Td className="text-right text-xs tabular-nums">{f.bytes(m.sizeBytes)}</Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        {isActive(m) ? <Spinner className="size-3" /> : null}
                        <StatusBadge kind="material" value={m.status} />
                      </span>
                      {m.latestJob?.processor === 'LOCAL_MOCK' && m.status !== 'READY' ? (
                        <Badge tone="violet" className="mt-1">
                          MOCK FC
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-muted-foreground">{f.relative(m.updatedAt)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" disabled={m.status !== 'READY' || access.pending} onClick={() => access.open(m, 'preview')} aria-label="Xem trước">
                        <Eye />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={m.status !== 'READY' || access.pending} onClick={() => access.open(m, 'download')} aria-label="Tải xuống">
                        <Download />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination meta={d.meta} onPage={setPage} />
          </>
        )}
      </QueryView>
      {access.dialog}
    </>
  )
}
