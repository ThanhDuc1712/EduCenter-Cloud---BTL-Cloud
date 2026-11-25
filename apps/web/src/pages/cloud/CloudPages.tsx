import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Activity, AlertTriangle, CheckCircle2, Clock, Cpu, Database, FolderOpen, HardDrive, KeyRound, RefreshCw, RotateCcw, Server, ShieldCheck, Timer, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Select, Table, TabPanel, Tabs, TBody, Td, Th, THead, Tr } from '@/components/ui/primitives'
import { EmptyState, KeyValue, PageHeader, Pagination, QueryView, SearchBox, Spinner, StatCard, StatusBadge, Toolbar } from '@/components/common'
import { ColumnChart, LineChart } from '@/components/charts'
import { api, type Page } from '@/lib/api'
import { useDebounced, usePage } from '@/lib/hooks'
import * as f from '@/lib/format'
import { statusLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'

type ServiceStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED' | 'MOCK' | 'LOCAL'

interface ServiceCheck {
  id: string
  provider: 'AZURE' | 'ALIYUN' | 'LOCAL'
  name: string
  status: ServiceStatus
  mode: 'CLOUD' | 'LOCAL'
  detail: string
  latencyMs: number | null
  facts: Record<string, string | number | boolean | null>
}

interface PipelineStats {
  windowHours: number
  total: number
  succeeded: number
  rejected: number
  failed: number
  running: number
  failureRate: number
  durationMs: { avg: number | null; p50: number | null; p95: number | null; max: number | null }
  callbackLatencyMs: { avg: number | null; p95: number | null }
  byProcessor: { ALIYUN_FC: number; LOCAL_MOCK: number }
  lastFinishedAt: string | null
  stuckMaterials: number
}

interface Overview {
  checkedAt: string
  mode: { storage: 'LOCAL' | 'OSS'; processing: 'LOCAL_MOCK' | 'ALIYUN_FC'; onAppService: boolean; label: 'LOCAL' | 'HYBRID' | 'CLOUD' }
  summary: { up: number; degraded: number; down: number; notConfigured: number; mock: number; local: number }
  services: ServiceCheck[]
  pipeline: PipelineStats
}

const useOverview = () => useQuery({ queryKey: ['cloud', 'overview'], queryFn: () => api.get<Overview>('/cloud/overview'), refetchInterval: 30_000 })

const PROVIDER_LABEL = { AZURE: 'Microsoft Azure', ALIYUN: 'Alibaba Cloud', LOCAL: 'Local' }

function ModeBanner({ mode }: { mode: Overview['mode'] }) {
  if (mode.label === 'CLOUD') return null
  return (
    <div className="mb-5 flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>
        Hệ thống đang ở <b>{mode.label} MODE</b>: storage = {mode.storage}, xử lý = {mode.processing}. Các thành phần đánh dấu <b>MOCK</b> chạy cục bộ để kiểm thử và <b>không phải</b> dịch vụ cloud thật; thành phần <b>NOT CONFIGURED</b> chưa có cấu hình/credential. Xem docs/cloud-architecture.md để chuyển sang CLOUD MODE.
      </p>
    </div>
  )
}

function ServiceCard({ s }: { s: ServiceCheck }) {
  const facts = Object.entries(s.facts).filter(([, v]) => v !== null && v !== '')
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{PROVIDER_LABEL[s.provider]}</p>
          <p className="font-medium">{s.name}</p>
        </div>
        <StatusBadge kind="service" value={s.status} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{s.detail}</p>
      {facts.length ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {facts.slice(0, 6).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono" title={String(v)}>
                {String(v)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      {s.latencyMs !== null ? <p className="mt-2 text-xs text-muted-foreground">Kiểm tra trong {s.latencyMs} ms</p> : null}
    </Card>
  )
}

export function CloudOverviewPage() {
  const q = useOverview()
  return (
    <>
      <PageHeader
        title="Cloud Overview"
        description="Trạng thái thực tế của Azure, Alibaba Cloud và luồng xử lý xuyên cloud (kiểm tra trực tiếp mỗi 30 giây)"
        actions={
          <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Spinner /> : <RefreshCw />} Kiểm tra lại
          </Button>
        }
      />
      <QueryView query={q} rows={8}>
        {(o) => (
          <>
            <ModeBanner mode={o.mode} />
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
              <StatCard label="Hoạt động" value={o.summary.up} tone="success" icon={CheckCircle2} />
              <StatCard label="Suy giảm" value={o.summary.degraded} tone="warning" />
              <StatCard label="Lỗi" value={o.summary.down} tone="danger" />
              <StatCard label="MOCK (local)" value={o.summary.mock} />
              <StatCard label="Not configured" value={o.summary.notConfigured} />
              <StatCard label="Job 24h" value={o.pipeline.total} hint={`${o.pipeline.failed} lỗi · ${o.pipeline.stuckMaterials} treo`} icon={Zap} />
            </div>
            {(['AZURE', 'ALIYUN', 'LOCAL'] as const).map((prov) => {
              const list = o.services.filter((s) => s.provider === prov && s.id !== 'pipeline')
              if (!list.length) return null
              return (
                <section key={prov} className="mb-5">
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{PROVIDER_LABEL[prov]}</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((s) => (
                      <ServiceCard key={s.id} s={s} />
                    ))}
                  </div>
                </section>
              )
            })}
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Cross-cloud pipeline</h2>
              <ServiceCard s={o.services.find((s) => s.id === 'pipeline')!} />
            </section>
            <p className="mt-4 text-xs text-muted-foreground">Kiểm tra lúc {f.dateTime(o.checkedAt)}</p>
          </>
        )}
      </QueryView>
    </>
  )
}

// ─────────────────────────── Architecture ───────────────────────────

const NODES: { id: string; label: string; sub: string; x: number; y: number; service?: string; group: 'client' | 'azure' | 'aliyun' }[] = [
  { id: 'browser', label: 'Browser', sub: 'Admin / Teacher / Student', x: 30, y: 200, group: 'client' },
  { id: 'app', label: 'App Service', sub: 'NestJS API + React SPA', x: 250, y: 200, service: 'app-service', group: 'azure' },
  { id: 'pg', label: 'PostgreSQL', sub: 'Flexible Server', x: 250, y: 340, service: 'postgresql', group: 'azure' },
  { id: 'kv', label: 'Key Vault', sub: 'Managed Identity', x: 250, y: 60, service: 'key-vault', group: 'azure' },
  { id: 'ai', label: 'App Insights', sub: 'Azure Monitor', x: 450, y: 60, service: 'app-insights', group: 'azure' },
  { id: 'q', label: 'OSS quarantine', sub: 'private · versioning', x: 520, y: 340, service: 'oss-quarantine', group: 'aliyun' },
  { id: 'fc', label: 'Function Compute', sub: 'material-processor', x: 750, y: 340, service: 'function-compute', group: 'aliyun' },
  { id: 'pub', label: 'OSS published', sub: 'doc · preview · result', x: 750, y: 200, service: 'oss-published', group: 'aliyun' },
  { id: 'sls', label: 'SLS', sub: 'worker logs', x: 950, y: 340, service: 'sls', group: 'aliyun' },
  { id: 'cms', label: 'CloudMonitor', sub: 'metrics · alarms', x: 950, y: 200, service: 'cloudmonitor', group: 'aliyun' },
]

const EDGES: { from: string; to: string; label: string; kind: 'data' | 'event' }[] = [
  { from: 'browser', to: 'app', label: '1 HTTPS same-origin', kind: 'data' },
  { from: 'app', to: 'pg', label: 'TLS · edu_runtime', kind: 'data' },
  { from: 'app', to: 'kv', label: 'secrets (MI)', kind: 'data' },
  { from: 'app', to: 'ai', label: 'telemetry', kind: 'data' },
  { from: 'browser', to: 'q', label: '2 PostObject ≤10MB', kind: 'data' },
  { from: 'q', to: 'fc', label: '3 ObjectCreated', kind: 'event' },
  { from: 'fc', to: 'pub', label: '4 doc + preview + JSON', kind: 'data' },
  { from: 'fc', to: 'app', label: '5 HMAC callback', kind: 'event' },
  { from: 'fc', to: 'sls', label: 'logs', kind: 'data' },
  { from: 'fc', to: 'cms', label: 'metrics', kind: 'data' },
  { from: 'browser', to: 'pub', label: '6 signed GET 120s', kind: 'data' },
]

const W = 150
const H = 58
const STATUS_FILL: Record<ServiceStatus, string> = { UP: '#ecfdf5', DEGRADED: '#fffbeb', DOWN: '#fef2f2', NOT_CONFIGURED: '#f4f4f5', MOCK: '#f5f3ff', LOCAL: '#eff6ff' }
const STATUS_STROKE: Record<ServiceStatus, string> = { UP: '#059669', DEGRADED: '#d97706', DOWN: '#dc2626', NOT_CONFIGURED: '#a1a1aa', MOCK: '#7c3aed', LOCAL: '#2563eb' }

function anchor(n: (typeof NODES)[number], other: (typeof NODES)[number]) {
  const cx = n.x + W / 2
  const cy = n.y + H / 2
  const dx = other.x + W / 2 - cx
  const dy = other.y + H / 2 - cy
  if (Math.abs(dx) * H > Math.abs(dy) * W) return { x: cx + (Math.sign(dx) * W) / 2, y: cy }
  return { x: cx, y: cy + (Math.sign(dy) * H) / 2 }
}

export function CloudArchitecturePage() {
  const q = useOverview()
  const status = (svc?: string): ServiceStatus => (svc ? q.data?.services.find((s) => s.id === svc)?.status ?? 'NOT_CONFIGURED' : 'UP')
  return (
    <>
      <PageHeader title="Cloud Architecture" description="Kiến trúc Multi-Cloud: Azure (ứng dụng, dữ liệu, bí mật, giám sát) + Alibaba Cloud (lưu trữ & xử lý học liệu). Màu nút = trạng thái thực tế." />
      {q.data ? <ModeBanner mode={q.data.mode} /> : null}
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <svg viewBox="0 0 1130 430" className="min-w-[900px]" role="img" aria-label="Sơ đồ kiến trúc EduCenter Cloud">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#71717a" />
              </marker>
              <marker id="arrow-e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#7c3aed" />
              </marker>
            </defs>
            <rect x={225} y={30} width={400} height={390} rx={14} fill="#eff6ff" opacity={0.5} />
            <text x={237} y={50} className="fill-blue-800 text-[12px] font-semibold">
              Microsoft Azure · Southeast Asia
            </text>
            <rect x={500} y={170} width={620} height={250} rx={14} fill="#fff7ed" opacity={0.55} />
            <text x={1110} y={190} textAnchor="end" className="fill-orange-800 text-[12px] font-semibold">
              Alibaba Cloud · Singapore
            </text>
            {EDGES.map((e, i) => {
              const a = NODES.find((n) => n.id === e.from)!
              const b = NODES.find((n) => n.id === e.to)!
              const p1 = anchor(a, b)
              const p2 = anchor(b, a)
              const mx = (p1.x + p2.x) / 2
              const my = (p1.y + p2.y) / 2
              return (
                <g key={i}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={e.kind === 'event' ? '#7c3aed' : '#71717a'} strokeWidth={1.5} strokeDasharray={e.kind === 'event' ? '5 4' : undefined} markerEnd={`url(#${e.kind === 'event' ? 'arrow-e' : 'arrow'})`} />
                  <rect x={mx - e.label.length * 3.1 - 4} y={my - 9} width={e.label.length * 6.2 + 8} height={16} rx={4} fill="white" opacity={0.92} />
                  <text x={mx} y={my + 3} textAnchor="middle" className="fill-zinc-700 text-[10px]">
                    {e.label}
                  </text>
                </g>
              )
            })}
            {NODES.map((n) => {
              const st = n.group === 'client' ? 'UP' : status(n.service)
              return (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={W} height={H} rx={10} fill={n.group === 'client' ? 'white' : STATUS_FILL[st]} stroke={n.group === 'client' ? '#71717a' : STATUS_STROKE[st]} strokeWidth={1.5} />
                  <text x={n.x + 12} y={n.y + 22} className="fill-zinc-900 text-[13px] font-semibold">
                    {n.label}
                  </text>
                  <text x={n.x + 12} y={n.y + 38} className="fill-zinc-500 text-[10px]">
                    {n.sub}
                  </text>
                  {n.group !== 'client' ? (
                    <text x={n.x + 12} y={n.y + 51} className="text-[9px] font-semibold" fill={STATUS_STROKE[st]}>
                      {statusLabel('service', st).label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-6 bg-zinc-500" /> Data flow
            </span>
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-6 border-t-2 border-dashed border-violet-600" /> Event flow (trigger, callback)
            </span>
            {(['UP', 'DEGRADED', 'DOWN', 'MOCK', 'NOT_CONFIGURED'] as ServiceStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="size-3 rounded border-2" style={{ background: STATUS_FILL[s], borderColor: STATUS_STROKE[s] }} /> {statusLabel('service', s).label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Luồng dữ liệu học liệu</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Trình duyệt gọi API (Azure) tạo tài liệu; API ký <b>PostObject policy</b> 5 phút (key cố định, ≤ 10 MB).</li>
              <li>Trình duyệt tải tệp <b>trực tiếp</b> lên OSS quarantine (private, versioning).</li>
              <li>Sự kiện <b>ObjectCreated</b> kích hoạt Function Compute (RAM role chỉ đọc quarantine / ghi published).</li>
              <li>FC kiểm tra PDF, đếm trang, đọc metadata, render preview PNG, ghi bản xử lý + result JSON vào OSS published.</li>
              <li>FC gửi <b>callback HMAC-SHA256</b> (raw body + timestamp + key ID) về API; API xác minh, chống replay, cập nhật PostgreSQL.</li>
              <li>Người dùng xem / tải bằng <b>signed URL</b> ngắn hạn. Reconciler đối soát job treo bằng result JSON.</li>
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bảo mật giữa các dịch vụ</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> App Service đọc secret qua <b>Managed Identity</b> + Key Vault reference (không hardcode).</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> PostgreSQL: TLS, runtime role <b>edu_runtime</b> không DDL / không superuser.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> OSS bucket private; RAM least privilege (API user, FC role, read-only ops user).</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> Callback: HMAC, so sánh constant-time, cửa sổ thời gian ±5 phút, eventId duy nhất, 2 key xoay vòng.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> API Cloud Ops chỉ ADMIN + giới hạn mạng (OPS_ALLOWED_CIDRS) trên production.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ─────────────────────────── Storage ───────────────────────────

interface StorageView {
  provider: 'LOCAL' | 'OSS'
  bucket: { role: string; name: string; health: { ok: boolean; versioning: string | null; lifecycle: string[]; detail: string } | null }
  prefix: string
  listingError: string | null
  truncated: boolean
  usage: { objects: number; bytes: number }
  objects: { key: string; size: number; lastModified: string | null; material: { id: string; title: string; status: string } | null }[]
  database: { byStatus: { status: string; count: number; bytes: number }[]; readyCount: number; readyBytes: number }
  uploadHistory: { id: string; title: string; status: string; originalFilename: string; sizeBytes: number | null; declaredSize: number; uploadedBy: string; createdAt: string; sourceVersionId: string | null }[]
  policies: { maxUploadBytes: number; uploadPolicyTtlSeconds: number; signedUrlTtlSeconds: number; uploadExpirySeconds: number }
}

export function StoragePage() {
  const [bucket, setBucket] = React.useState<'quarantine' | 'published'>('published')
  const [prefix, setPrefix] = React.useState('')
  const dp = useDebounced(prefix)
  const q = useQuery({ queryKey: ['cloud', 'storage', bucket, dp], queryFn: () => api.get<StorageView>('/cloud/storage', { bucket, prefix: dp, limit: 300 }) })
  return (
    <>
      <PageHeader title="Storage Management" description="Object trong bucket quarantine / published, metadata, version, dung lượng và chính sách vòng đời" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['quarantine', 'published'] as const).map((b) => (
          <Button key={b} variant={bucket === b ? 'default' : 'outline'} size="sm" onClick={() => setBucket(b)}>
            {b === 'quarantine' ? 'Quarantine (upload)' : 'Published (đã xử lý)'}
          </Button>
        ))}
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Lọc theo prefix, vd: results/" className="w-64" aria-label="Prefix" />
      </div>
      <QueryView query={q} rows={8}>
        {(s) => (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Bucket" value={<span className="font-mono text-sm">{s.bucket.name}</span>} hint={s.provider === 'OSS' ? 'Alibaba Cloud OSS' : 'LOCAL (MOCK OSS)'} icon={HardDrive} />
              <StatCard label="Object (đang liệt kê)" value={s.usage.objects} hint={f.bytes(s.usage.bytes) + (s.truncated ? ' · bị cắt bớt' : '')} icon={FolderOpen} />
              <StatCard label="Tài liệu READY" value={s.database.readyCount} hint={f.bytes(s.database.readyBytes)} />
              <StatCard label="Versioning" value={<span className="text-sm">{s.bucket.health?.versioning ?? '—'}</span>} hint={s.bucket.health?.detail} />
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Object</CardTitle>
                  {s.listingError ? <Badge tone="danger">{s.listingError}</Badge> : null}
                </CardHeader>
                {s.objects.length ? (
                  <Table>
                    <THead>
                      <tr>
                        <Th>Key</Th>
                        <Th className="text-right">Kích thước</Th>
                        <Th>Sửa đổi</Th>
                        <Th>Tài liệu</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {s.objects.map((o) => (
                        <Tr key={o.key}>
                          <Td className="max-w-96 truncate font-mono text-xs" title={o.key}>
                            {o.key}
                          </Td>
                          <Td className="text-right text-xs tabular-nums">{f.bytes(o.size)}</Td>
                          <Td className="text-xs">{f.dateTime(o.lastModified)}</Td>
                          <Td>
                            {o.material ? (
                              <Link to={`/materials/${o.material.id}`} className="flex items-center gap-1.5 text-xs hover:underline">
                                <StatusBadge kind="material" value={o.material.status} /> <span className="max-w-40 truncate">{o.material.title}</span>
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">mồ côi</span>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState title="Bucket trống với prefix này" />
                )}
              </Card>
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle>Lifecycle & chính sách</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(s.bucket.health?.lifecycle.length ? s.bucket.health.lifecycle : ['Chưa có rule lifecycle']).map((l) => (
                      <p key={l} className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {l}
                      </p>
                    ))}
                    <KeyValue
                      className="mt-3 sm:grid-cols-1"
                      items={[
                        ['Upload tối đa', f.bytes(s.policies.maxUploadBytes)],
                        ['Hiệu lực upload policy', `${s.policies.uploadPolicyTtlSeconds} giây`],
                        ['Hiệu lực signed URL', `${s.policies.signedUrlTtlSeconds} giây`],
                        ['Upload hết hạn (reconciler)', `${Math.round(s.policies.uploadExpirySeconds / 60)} phút`],
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Theo trạng thái (DB)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm">
                      {s.database.byStatus.map((b) => (
                        <li key={b.status} className="flex justify-between">
                          <StatusBadge kind="material" value={b.status} />
                          <span className="tabular-nums">
                            {b.count} · {f.bytes(b.bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
            <Card className="mt-5">
              <CardHeader>
                <CardTitle>Lịch sử upload gần đây</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <tr>
                    <Th>Thời gian</Th>
                    <Th>Tài liệu</Th>
                    <Th>Người tải</Th>
                    <Th className="text-right">Kích thước</Th>
                    <Th>Version</Th>
                    <Th>Trạng thái</Th>
                  </tr>
                </THead>
                <TBody>
                  {s.uploadHistory.map((u) => (
                    <Tr key={u.id}>
                      <Td className="text-xs">{f.dateTime(u.createdAt)}</Td>
                      <Td>
                        <Link to={`/materials/${u.id}`} className="hover:underline">
                          {u.title}
                        </Link>
                      </Td>
                      <Td className="text-xs">{u.uploadedBy}</Td>
                      <Td className="text-right text-xs tabular-nums">{f.bytes(u.sizeBytes ?? u.declaredSize)}</Td>
                      <Td className="max-w-40 truncate font-mono text-xs">{u.sourceVersionId ?? '—'}</Td>
                      <Td>
                        <StatusBadge kind="material" value={u.status} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          </>
        )}
      </QueryView>
    </>
  )
}

// ─────────────────────────── Jobs ───────────────────────────

interface Job {
  id: string
  attempt: number
  processor: 'ALIYUN_FC' | 'LOCAL_MOCK'
  status: string
  correlationId: string
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  callbackLatencyMs: number | null
  errorCode: string | null
  errorMessage: string | null
  material: { id: string; title: string; status: string; originalFilename: string; pageCount: number | null }
}

interface LogEntry {
  id: string
  provider: string
  service: string
  level: string
  event: string
  message: string
  correlationId: string | null
  materialId: string | null
  durationMs: number | null
  createdAt: string
}

function JobDetailDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['cloud', 'job', jobId], queryFn: () => api.get<{ job: Job; events: { id: string; type: string; source: string; fromStatus: string | null; toStatus: string | null; createdAt: string }[]; logs: LogEntry[] }>(`/cloud/jobs/${jobId}`), enabled: !!jobId })
  return (
    <Dialog open={!!jobId} onOpenChange={(o) => !o && onClose()} title="Chi tiết processing job" size="lg">
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-4">
            <KeyValue
              items={[
                ['Tài liệu', <Link to={`/materials/${d.job.material.id}`} className="hover:underline">{d.job.material.title}</Link>],
                ['Correlation ID', <span className="font-mono text-xs">{d.job.correlationId}</span>],
                ['Lần thử', d.job.attempt],
                ['Bộ xử lý', d.job.processor],
                ['Trạng thái', <StatusBadge kind="job" value={d.job.status} />],
                ['Thời gian xử lý', f.ms(d.job.durationMs)],
                ['Độ trễ callback', f.ms(d.job.callbackLatencyMs)],
                ['Lỗi', d.job.errorCode ? `${d.job.errorCode}: ${d.job.errorMessage}` : '—'],
              ]}
            />
            <div>
              <p className="mb-1 text-sm font-medium">Sự kiện trạng thái</p>
              <ul className="space-y-1 text-xs">
                {d.events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-muted-foreground">{f.dateTime(e.createdAt)}</span> <span className="font-medium">{e.type}</span> {e.source} · {e.fromStatus ?? '∅'} → {e.toStatus ?? '∅'}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Log liên quan</p>
              <ul className="max-h-60 space-y-1 overflow-y-auto font-mono text-xs">
                {d.logs.map((l) => (
                  <li key={l.id}>
                    <span className="text-muted-foreground">{f.time(l.createdAt)}</span> [{l.provider}/{l.service}] {l.level} {l.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </QueryView>
    </Dialog>
  )
}

export function JobsPage({ functionView = false }: { functionView?: boolean }) {
  const qc = useQueryClient()
  const [status, setStatus] = React.useState('')
  const [processor, setProcessor] = React.useState(functionView ? '' : '')
  const [search, setSearch] = React.useState('')
  const [detail, setDetail] = React.useState<string | null>(null)
  const dq = useDebounced(search)
  const [page, setPage] = usePage([status, processor, dq])
  const q = useQuery({ queryKey: ['cloud', 'jobs', status, processor, dq, page], queryFn: () => api.get<Page<Job> & { stats: PipelineStats }>('/cloud/jobs', { status, processor, q: dq, page, pageSize: 20 }), refetchInterval: 10_000 })
  const runs = useQuery({ queryKey: ['cloud', 'reconciler'], queryFn: () => api.get<{ id: string; startedAt: string; finishedAt: string | null; status: string; summary: Record<string, number | string> | null }[]>('/cloud/reconciler') })
  const overview = useOverview()
  const reconcile = useMutation({
    mutationFn: () => api.post<Record<string, number | string>>('/cloud/reconciler/run'),
    onSuccess: (r) => {
      toast.success(r.skipped ? 'Reconciler đang chạy ở instance khác' : `Đối soát xong: ${r.resultsApplied} áp dụng, ${r.retried} thử lại, ${r.failed} lỗi`)
      qc.invalidateQueries({ queryKey: ['cloud'] })
    },
    onError: (e) => toast.error(String(e)),
  })
  const retry = useMutation({
    mutationFn: (materialId: string) => api.post(`/cloud/materials/${materialId}/retry`),
    onSuccess: () => {
      toast.success('Đã gửi xử lý lại')
      qc.invalidateQueries({ queryKey: ['cloud'] })
    },
    onError: (e) => toast.error(String(e)),
  })
  const fc = overview.data?.services.find((s) => s.id === 'function-compute')
  return (
    <>
      <PageHeader
        title={functionView ? 'Function Compute' : 'Processing Jobs'}
        description={functionView ? 'Hàm material-processor: lượt gọi, thời gian chạy, lỗi và retry (suy ra từ callback + CloudMonitor khi cấu hình)' : 'Từng lần xử lý tài liệu: thời gian, lỗi, retry, lịch sử — reconciler đối soát job treo'}
        actions={
          <Button variant="outline" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
            {reconcile.isPending ? <Spinner /> : <RotateCcw />} Chạy đối soát ngay
          </Button>
        }
      />
      {functionView && fc ? (
        <Card className="mb-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{fc.name}</p>
              <p className="text-sm text-muted-foreground">{fc.detail}</p>
            </div>
            <StatusBadge kind="service" value={fc.status} />
          </div>
          <KeyValue className="mt-3 sm:grid-cols-4" items={[['Runtime', 'Python 3.12 (FC 3.0)'], ['Trigger', 'OSS ObjectCreated (quarantine)'], ['Timeout / bộ nhớ', '120 s / 1024 MB'], ['Retry bất đồng bộ', '2 lần + reconciler']]} />
        </Card>
      ) : null}
      <QueryView query={q} rows={8}>
        {(d) => (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
              <StatCard label="Lượt xử lý 24h" value={d.stats.total} icon={Cpu} />
              <StatCard label="Thành công" value={d.stats.succeeded} tone="success" />
              <StatCard label="Từ chối (nội dung)" value={d.stats.rejected} tone="warning" />
              <StatCard label="Lỗi / quá hạn" value={d.stats.failed} tone={d.stats.failed ? 'danger' : 'default'} hint={`Tỷ lệ lỗi ${d.stats.failureRate}%`} />
              <StatCard label="Thời gian p50 / p95" value={<span className="text-lg">{f.ms(d.stats.durationMs.p50)} / {f.ms(d.stats.durationMs.p95)}</span>} icon={Timer} />
              <StatCard label="Callback TB / p95" value={<span className="text-lg">{f.ms(d.stats.callbackLatencyMs.avg)} / {f.ms(d.stats.callbackLatencyMs.p95)}</span>} icon={Clock} />
            </div>
            <Card>
              <Toolbar>
                <SearchBox value={search} onChange={setSearch} placeholder="Correlation ID hoặc tên tài liệu" />
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Trạng thái">
                  <option value="">Mọi trạng thái</option>
                  {['QUEUED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'TIMED_OUT'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <Select value={processor} onChange={(e) => setProcessor(e.target.value)} className="w-auto" aria-label="Bộ xử lý">
                  <option value="">Mọi bộ xử lý</option>
                  <option value="ALIYUN_FC">ALIYUN_FC</option>
                  <option value="LOCAL_MOCK">LOCAL_MOCK</option>
                </Select>
              </Toolbar>
              {d.items.length ? (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Job / correlation</Th>
                        <Th>Tài liệu</Th>
                        <Th>Bộ xử lý</Th>
                        <Th>Bắt đầu</Th>
                        <Th className="text-right">Thời gian</Th>
                        <Th>Trạng thái</Th>
                        <Th>Lỗi</Th>
                        <Th />
                      </tr>
                    </THead>
                    <TBody>
                      {d.items.map((j) => (
                        <Tr key={j.id}>
                          <Td>
                            <button className="font-mono text-xs hover:underline" onClick={() => setDetail(j.id)}>
                              {j.correlationId}
                            </button>
                            <div className="text-xs text-muted-foreground">lần {j.attempt}</div>
                          </Td>
                          <Td className="max-w-56 truncate">
                            <Link to={`/materials/${j.material.id}`} className="hover:underline">
                              {j.material.title}
                            </Link>
                          </Td>
                          <Td>
                            <Badge tone={j.processor === 'ALIYUN_FC' ? 'info' : 'violet'}>{j.processor}</Badge>
                          </Td>
                          <Td className="text-xs">{f.dateTime(j.startedAt ?? j.queuedAt)}</Td>
                          <Td className="text-right text-xs tabular-nums">{f.ms(j.durationMs)}</Td>
                          <Td>
                            <StatusBadge kind="job" value={j.status} />
                          </Td>
                          <Td className="max-w-48 truncate text-xs text-destructive" title={j.errorMessage ?? ''}>
                            {j.errorCode ?? ''}
                          </Td>
                          <Td className="text-right">
                            {(j.status === 'FAILED' || j.status === 'TIMED_OUT') && (j.material.status === 'FAILED' || j.material.status === 'PROCESSING') ? (
                              <Button size="sm" variant="outline" onClick={() => retry.mutate(j.material.id)} disabled={retry.isPending}>
                                <RotateCcw /> Retry
                              </Button>
                            ) : null}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                  <Pagination meta={d.meta} onPage={setPage} />
                </>
              ) : (
                <EmptyState title="Chưa có job xử lý" description="Tải lên một tài liệu PDF để tạo job." />
              )}
            </Card>
          </>
        )}
      </QueryView>
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Lịch sử reconciler (pg_try_advisory_lock)</CardTitle>
        </CardHeader>
        <QueryView query={runs} isEmpty={(r) => r.length === 0} empty={<EmptyState title="Chưa có lần chạy" />}>
          {(r) => (
            <Table>
              <THead>
                <tr>
                  <Th>Bắt đầu</Th>
                  <Th>Trạng thái</Th>
                  <Th>Kết quả</Th>
                </tr>
              </THead>
              <TBody>
                {r.map((x) => (
                  <Tr key={x.id}>
                    <Td className="text-xs">{f.dateTime(x.startedAt)}</Td>
                    <Td>
                      <Badge tone={x.status === 'SUCCEEDED' ? 'success' : x.status === 'FAILED' ? 'danger' : 'info'}>{x.status}</Badge>
                    </Td>
                    <Td className="font-mono text-xs">{x.summary ? Object.entries(x.summary).filter(([k]) => k !== 'trigger').map(([k, v]) => `${k}=${v}`).join(' ') : ''}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </QueryView>
      </Card>
      <JobDetailDialog jobId={detail} onClose={() => setDetail(null)} />
    </>
  )
}

export function FunctionComputePage() {
  return <JobsPage functionView />
}

// ─────────────────────────── Monitoring ───────────────────────────

interface MetricSummary {
  name: string
  count: number
  errors: number
  errorRate: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  series: { at: string; count: number; errors: number; avgMs: number; p95Ms: number }[]
}

interface External<T> {
  status: 'OK' | 'NOT_CONFIGURED' | 'ERROR'
  note?: string
  data?: T
}

type AzureMetric = { name: string; label: string; unit: string; points: { at: string; total: number | null; average: number | null }[] }

interface MetricsView {
  windowMinutes: number
  instance: { startedAt: string; appInsights: boolean }
  inProcess: MetricSummary[]
  pipeline: PipelineStats
  database: { backends: number; commits: number; rollbacks: number; cacheHitRatio: number | null; deadlocks: number; sizeBytes: number; pingMs: number } | null
  storage: { materials: number; bytes: number }
  azureMonitor: { appService: External<AzureMetric[]>; postgres: External<AzureMetric[]> }
  cloudMonitor: { functionCompute: External<{ invocations: { at: string; value: number }[]; errors: { at: string; value: number }[]; latencyAvgMs: { at: string; value: number }[] }> }
}

const METRIC_LABEL: Record<string, string> = { 'api.request': 'API latency', 'callback.latency': 'Callback latency (FC → API)', 'callback.http': 'Callback HTTP (worker side)', 'callback.handle': 'Xử lý callback', 'fc.duration': 'Function Compute duration', 'local.processor': 'Local processor (MOCK)', 'local.processor.duration': 'Local processor duration', 'oss.put': 'OSS put', 'oss.get': 'OSS get', 'oss.head': 'OSS head', 'oss.list': 'OSS list', 'oss.copy': 'OSS copy', 'oss.delete': 'OSS delete', 'storage.local.upload': 'Local upload', 'storage.sign': 'Ký signed URL', 'keyvault.list': 'Key Vault', 'azure.api': 'Azure API' }

function ExternalBlock<T>({ title, block, children }: { title: string; block: External<T>; children: (d: T) => React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge tone={block.status === 'OK' ? 'success' : block.status === 'ERROR' ? 'danger' : 'muted'}>{block.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : block.status}</Badge>
      </CardHeader>
      <CardContent>{block.status === 'OK' && block.data ? children(block.data) : <p className="text-sm text-muted-foreground">{block.note}</p>}</CardContent>
    </Card>
  )
}

export function MonitoringPage() {
  const [window, setWindow] = React.useState(60)
  const q = useQuery({ queryKey: ['cloud', 'metrics', window], queryFn: () => api.get<MetricsView>('/cloud/metrics', { window }), refetchInterval: 15_000 })
  return (
    <>
      <PageHeader
        title="Cloud Monitoring"
        description="API latency, error rate, thời gian xử lý, callback, storage, database — in-process + Azure Monitor + CloudMonitor (khi được cấu hình)"
        actions={
          <Select value={window} onChange={(e) => setWindow(Number(e.target.value))} className="w-auto" aria-label="Cửa sổ thời gian">
            <option value={15}>15 phút</option>
            <option value={60}>60 phút</option>
            <option value={120}>120 phút</option>
          </Select>
        }
      />
      <QueryView query={q} rows={8}>
        {(m) => {
          const api = m.inProcess.find((x) => x.name === 'api.request')
          const cb = m.inProcess.find((x) => x.name === 'callback.latency')
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <StatCard label="API requests" value={api?.count ?? 0} hint={`instance từ ${f.time(m.instance.startedAt)}`} icon={Activity} />
                <StatCard label="API p95" value={f.ms(api?.p95Ms)} hint={`TB ${f.ms(api?.avgMs)}`} icon={Timer} />
                <StatCard label="Error rate (5xx)" value={`${api?.errorRate ?? 0}%`} tone={(api?.errorRate ?? 0) > 1 ? 'danger' : 'success'} />
                <StatCard label="Function p95" value={f.ms(m.pipeline.durationMs.p95)} hint={`${m.pipeline.total} lượt / 24h`} icon={Cpu} />
                <StatCard label="Function failures" value={m.pipeline.failed} tone={m.pipeline.failed ? 'danger' : 'default'} hint={`${m.pipeline.failureRate}%`} />
                <StatCard label="Callback p95" value={f.ms(cb?.p95Ms ?? m.pipeline.callbackLatencyMs.p95)} icon={Zap} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>API latency p95 theo phút (ms)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart ariaLabel="API latency p95" format={(n) => `${Math.round(n)}`} data={(api?.series ?? []).map((s) => ({ label: f.time(s.at), title: `${f.time(s.at)} · ${s.count} req · ${s.errors} lỗi`, value: s.p95Ms }))} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>API requests theo phút</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ColumnChart ariaLabel="API requests theo phút" height={160} data={(api?.series ?? []).slice(-20).map((s) => ({ label: f.time(s.at), value: s.count }))} />
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Dependency & thao tác (instance hiện tại, {m.windowMinutes} phút)</CardTitle>
                  <Badge tone={m.instance.appInsights ? 'success' : 'muted'}>{m.instance.appInsights ? 'Cũng gửi tới Application Insights' : 'App Insights NOT CONFIGURED'}</Badge>
                </CardHeader>
                <Table>
                  <THead>
                    <tr>
                      <Th>Chỉ số</Th>
                      <Th className="text-right">Số lần</Th>
                      <Th className="text-right">Lỗi</Th>
                      <Th className="text-right">TB</Th>
                      <Th className="text-right">p50</Th>
                      <Th className="text-right">p95</Th>
                      <Th className="text-right">Max</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {m.inProcess.map((x) => (
                      <Tr key={x.name}>
                        <Td>
                          {METRIC_LABEL[x.name] ?? x.name} <span className="font-mono text-xs text-muted-foreground">{x.name}</span>
                        </Td>
                        <Td className="text-right tabular-nums">{x.count}</Td>
                        <Td className={cn('text-right tabular-nums', x.errors && 'text-destructive')}>{x.errors}</Td>
                        <Td className="text-right tabular-nums">{f.ms(x.avgMs)}</Td>
                        <Td className="text-right tabular-nums">{f.ms(x.p50Ms)}</Td>
                        <Td className="text-right tabular-nums">{f.ms(x.p95Ms)}</Td>
                        <Td className="text-right tabular-nums">{f.ms(x.maxMs)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </Card>
              <div className="grid gap-5 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Database className="mr-1 inline size-4" /> Database
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {m.database ? (
                      <KeyValue
                        items={[
                          ['Kết nối', m.database.backends],
                          ['Ping', `${m.database.pingMs} ms`],
                          ['Cache hit', m.database.cacheHitRatio === null ? '—' : `${m.database.cacheHitRatio}%`],
                          ['Dung lượng', f.bytes(m.database.sizeBytes)],
                          ['Commit / rollback', `${m.database.commits} / ${m.database.rollbacks}`],
                          ['Deadlock', m.database.deadlocks],
                        ]}
                      />
                    ) : (
                      <p className="text-sm text-destructive">Không đọc được pg_stat_database</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <HardDrive className="mr-1 inline size-4" /> Storage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeyValue items={[['Tài liệu', m.storage.materials], ['Dung lượng (DB)', f.bytes(m.storage.bytes)]]} />
                  </CardContent>
                </Card>
                <ExternalBlock title="CloudMonitor · Function Compute" block={m.cloudMonitor.functionCompute}>
                  {(d) => <ColumnChart ariaLabel="FC invocations" height={140} data={d.invocations.slice(-12).map((p) => ({ label: f.time(p.at), value: p.value }))} />}
                </ExternalBlock>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <ExternalBlock title="Azure Monitor · App Service" block={m.azureMonitor.appService}>
                  {(d) => (
                    <ul className="space-y-1 text-sm">
                      {d.map((x) => (
                        <li key={x.name} className="flex justify-between">
                          <span>{x.label}</span>
                          <span className="tabular-nums">{x.points.reduce((s, p) => s + (p.total ?? p.average ?? 0), 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} {x.unit}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ExternalBlock>
                <ExternalBlock title="Azure Monitor · PostgreSQL" block={m.azureMonitor.postgres}>
                  {(d) => (
                    <ul className="space-y-1 text-sm">
                      {d.map((x) => {
                        const vals = x.points.map((p) => p.average).filter((v): v is number => v !== null)
                        return (
                          <li key={x.name} className="flex justify-between">
                            <span>{x.label}</span>
                            <span className="tabular-nums">{vals.length ? vals[vals.length - 1].toFixed(1) : '—'} {x.unit}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </ExternalBlock>
              </div>
            </div>
          )
        }}
      </QueryView>
    </>
  )
}

// ─────────────────────────── Logs ───────────────────────────

export function LogsPage() {
  const [source, setSource] = React.useState<'app' | 'sls' | 'azure'>('app')
  const [provider, setProvider] = React.useState('')
  const [service, setService] = React.useState('')
  const [level, setLevel] = React.useState('')
  const [text, setText] = React.useState('')
  const [correlationId, setCorrelationId] = React.useState('')
  const [from, setFrom] = React.useState(() => new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 16))
  const dq = useDebounced(text)
  const dc = useDebounced(correlationId)
  const [page, setPage] = usePage([source, provider, service, level, dq, dc, from])
  const q = useQuery({
    queryKey: ['cloud', 'logs', source, provider, service, level, dq, dc, from, page],
    queryFn: () => api.get<{ status: string; note?: string; items: (LogEntry & { time?: string })[]; meta?: Page<unknown>['meta']; facets?: { provider: string; service: string; count: number }[] }>('/cloud/logs', { source, provider, service, level, q: dq, correlationId: dc, from: new Date(from).toISOString(), page, pageSize: 50 }),
    refetchInterval: 15_000,
  })
  const services = [...new Set(q.data?.facets?.map((x) => x.service) ?? [])]
  return (
    <>
      <PageHeader title="Cloud Logs" description="Tìm kiếm log vận hành theo nhà cung cấp, dịch vụ, thời gian, mức độ và correlation ID" />
      <Tabs value={source} onValueChange={(v) => setSource(v as 'app' | 'sls' | 'azure')} tabs={[{ value: 'app', label: 'Ops log (PostgreSQL)' }, { value: 'sls', label: 'Alibaba SLS' }, { value: 'azure', label: 'Azure Log Analytics' }]}>
        <Card>
          <Toolbar>
            <SearchBox value={text} onChange={setText} placeholder="Từ khóa" />
            <Input value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} placeholder="Correlation ID" className="w-56 font-mono" aria-label="Correlation ID" />
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="Từ thời điểm" />
            <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto" aria-label="Mức độ">
              <option value="">Mọi mức</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </Select>
            {source === 'app' ? (
              <>
                <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-auto" aria-label="Provider">
                  <option value="">Mọi provider</option>
                  <option value="AZURE">AZURE</option>
                  <option value="ALIYUN">ALIYUN</option>
                  <option value="LOCAL">LOCAL</option>
                </Select>
                <Select value={service} onChange={(e) => setService(e.target.value)} className="w-auto" aria-label="Service">
                  <option value="">Mọi service</option>
                  {services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}
          </Toolbar>
          <QueryView query={q} rows={10}>
            {(d) =>
              d.status !== 'OK' ? (
                <div className="p-6 text-center">
                  <Badge tone={d.status === 'ERROR' ? 'danger' : 'muted'}>{d.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : d.status}</Badge>
                  <p className="mt-2 text-sm text-muted-foreground">{d.note}</p>
                </div>
              ) : d.items.length === 0 ? (
                <EmptyState title="Không có log phù hợp" />
              ) : (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Thời gian</Th>
                        <Th>Mức</Th>
                        {source === 'app' ? <Th>Nguồn</Th> : null}
                        <Th>Nội dung</Th>
                        <Th>Correlation</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {d.items.map((l, i) => (
                        <Tr key={l.id ?? i}>
                          <Td className="text-xs whitespace-nowrap">{f.dateTime(l.createdAt ?? l.time)}</Td>
                          <Td>{l.level ? <StatusBadge kind="level" value={String(l.level)} /> : '—'}</Td>
                          {source === 'app' ? (
                            <Td className="text-xs whitespace-nowrap">
                              <Badge tone={l.provider === 'AZURE' ? 'info' : l.provider === 'ALIYUN' ? 'warning' : 'violet'}>{l.provider}</Badge> {l.service}
                            </Td>
                          ) : null}
                          <Td className="text-sm">
                            {l.event ? <span className="mr-1 font-mono text-xs text-muted-foreground">{l.event}</span> : null}
                            {l.message}
                            {l.durationMs ? <span className="ml-1 text-xs text-muted-foreground">({f.ms(l.durationMs)})</span> : null}
                          </Td>
                          <Td>
                            {l.correlationId ? (
                              <button className="max-w-48 truncate font-mono text-xs text-primary hover:underline" onClick={() => setCorrelationId(l.correlationId!)}>
                                {l.correlationId}
                              </button>
                            ) : null}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                  {d.meta ? <Pagination meta={d.meta} onPage={setPage} /> : null}
                </>
              )
            }
          </QueryView>
        </Card>
      </Tabs>
    </>
  )
}

// ─────────────────────────── Resources + cost ───────────────────────────

interface Resource {
  provider: string
  type: string
  name: string | null
  detail: string
  configured: boolean
}

interface Resources {
  mode: Overview['mode']
  azure: Resource[]
  aliyun: Resource[]
  local: Resource[]
  secrets: { status: string; note?: string; items: { name: string; enabled: boolean | null; updatedOn: string | null; expiresOn: string | null; versions: number; daysToExpiry: number | null }[] }
  security: { demoMode: boolean; hmacKeyIds: string[]; activeHmacKeyId: string; opsNetworkRestricted: boolean }
}

interface Cost {
  period: string
  azure: { status: string; note: string | null; items: { service: string; cost: number; currency: string }[]; total: number | null; currency?: string | null }
  aliyun: { status: string; note: string | null; items: { service: string; cost: number; currency: string }[]; total: number | null; currency?: string | null }
  disclaimer: string
}

function ResourceTable({ rows }: { rows: Resource[] }) {
  return (
    <Table>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.type}>
            <Td className="w-56 font-medium">{r.type}</Td>
            <Td className="font-mono text-xs">{r.name ?? '—'}</Td>
            <Td className="text-xs text-muted-foreground">{r.detail}</Td>
            <Td className="text-right">{r.configured ? <Badge tone="success">Đã cấu hình</Badge> : <Badge tone="muted">NOT CONFIGURED</Badge>}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}

export function ResourcesPage() {
  const [tab, setTab] = React.useState('resources')
  const q = useQuery({ queryKey: ['cloud', 'resources'], queryFn: () => api.get<Resources>('/cloud/resources') })
  const cost = useQuery({ queryKey: ['cloud', 'cost'], queryFn: () => api.get<Cost>('/cloud/cost'), enabled: tab === 'cost' })
  return (
    <>
      <PageHeader title="Cloud Resources" description="Tài nguyên Azure / Alibaba Cloud, secret (chỉ metadata), bảo mật dịch vụ và chi phí" />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'resources', label: 'Tài nguyên' }, { value: 'secrets', label: 'Key Vault & bảo mật' }, { value: 'cost', label: 'Chi phí' }]}>
        <TabPanel value="resources">
          <QueryView query={q}>
            {(r) => (
              <div className="space-y-5">
                <ModeBanner mode={r.mode} />
                {(
                  [
                    ['Microsoft Azure', r.azure, Server],
                    ['Alibaba Cloud', r.aliyun, HardDrive],
                    ['Local (MOCK / dev)', r.local, Cpu],
                  ] as const
                ).map(([title, rows, Icon]) => (
                  <Card key={title}>
                    <CardHeader>
                      <CardTitle>
                        <Icon className="mr-1 inline size-4" /> {title}
                      </CardTitle>
                    </CardHeader>
                    <ResourceTable rows={rows} />
                  </Card>
                ))}
              </div>
            )}
          </QueryView>
        </TabPanel>
        <TabPanel value="secrets">
          <QueryView query={q}>
            {(r) => (
              <div className="grid gap-5 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>
                      <KeyRound className="mr-1 inline size-4" /> Secret trong Key Vault (metadata — không bao giờ trả giá trị)
                    </CardTitle>
                    <Badge tone={r.secrets.status === 'OK' ? 'success' : r.secrets.status === 'ERROR' ? 'danger' : 'muted'}>{r.secrets.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : r.secrets.status}</Badge>
                  </CardHeader>
                  {r.secrets.items.length ? (
                    <Table>
                      <THead>
                        <tr>
                          <Th>Tên</Th>
                          <Th>Bật</Th>
                          <Th className="text-right">Số version</Th>
                          <Th>Cập nhật</Th>
                          <Th>Hết hạn</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {r.secrets.items.map((s) => (
                          <Tr key={s.name}>
                            <Td className="font-mono text-xs">{s.name}</Td>
                            <Td>{s.enabled ? 'Có' : 'Không'}</Td>
                            <Td className="text-right">{s.versions}</Td>
                            <Td className="text-xs">{f.dateTime(s.updatedOn)}</Td>
                            <Td className={cn('text-xs', s.daysToExpiry !== null && s.daysToExpiry < 30 && 'font-medium text-destructive')}>{s.expiresOn ? `${f.date(s.expiresOn)} (${s.daysToExpiry} ngày)` : 'Không đặt'}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  ) : (
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{r.secrets.note}</p>
                    </CardContent>
                  )}
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Bảo mật dịch vụ</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeyValue
                      className="sm:grid-cols-1"
                      items={[
                        ['HMAC key IDs đang hiệu lực', r.security.hmacKeyIds.join(', ')],
                        ['Key ký của worker local', r.security.activeHmacKeyId],
                        ['Demo mode (chuyển vai trò)', r.security.demoMode ? 'BẬT — chỉ dùng cho demo' : 'Tắt'],
                        ['Giới hạn mạng Cloud Ops API', r.security.opsNetworkRestricted ? 'OPS_ALLOWED_CIDRS đã đặt' : 'Chưa đặt (production sẽ từ chối)'],
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </QueryView>
        </TabPanel>
        <TabPanel value="cost">
          <QueryView query={cost}>
            {(c) => (
              <>
                <div className="grid gap-5 lg:grid-cols-2">
                  {(
                    [
                      ['Microsoft Azure', c.azure],
                      ['Alibaba Cloud', c.aliyun],
                    ] as const
                  ).map(([title, b]) => (
                    <Card key={title}>
                      <CardHeader>
                        <CardTitle>
                          {title} · {c.period}
                        </CardTitle>
                        <Badge tone={b.status === 'OK' ? 'success' : 'muted'}>{b.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : b.status}</Badge>
                      </CardHeader>
                      <CardContent>
                        {b.status === 'OK' ? (
                          <>
                            <p className="mb-3 text-2xl font-semibold tabular-nums">
                              {b.total?.toLocaleString('vi-VN')} {b.currency}
                            </p>
                            <ul className="space-y-1 text-sm">
                              {b.items.map((i) => (
                                <li key={i.service} className="flex justify-between">
                                  <span>{i.service}</span>
                                  <span className="tabular-nums">
                                    {i.cost.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} {i.currency}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">{b.note}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{c.disclaimer}</p>
              </>
            )}
          </QueryView>
        </TabPanel>
      </Tabs>
    </>
  )
}
