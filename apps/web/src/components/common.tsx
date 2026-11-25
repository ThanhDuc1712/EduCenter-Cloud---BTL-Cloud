import * as React from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, Dialog, Input, Skeleton } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/api'
import { statusLabel, STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = { default: 'text-primary bg-primary/10', success: 'text-emerald-700 bg-emerald-50', warning: 'text-amber-700 bg-amber-50', danger: 'text-red-700 bg-red-50' }[tone]
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn('rounded-lg p-2', toneClass)}>
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
    </Card>
  )
}

export function StatusBadge({ kind, value }: { kind: keyof typeof STATUS; value: string | null | undefined }) {
  const s = statusLabel(kind, value)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center" role="alert">
      <AlertTriangle className="size-8 text-destructive" />
      <div>
        <p className="font-medium">Không tải được dữ liệu</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Thử lại
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title = 'Chưa có dữ liệu', description, action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  )
}

/** Loading / error / empty / content switch for a TanStack query. */
export function QueryView<T>({ query, empty, isEmpty, children, rows }: { query: { data?: T; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty?: React.ReactNode; isEmpty?: (d: T) => boolean; children: (d: T) => React.ReactNode; rows?: number }) {
  if (query.isLoading) return <LoadingState rows={rows} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (query.data === undefined) return null
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState />}</>
  return <>{children(query.data)}</>
}

export function Pagination({ meta, onPage }: { meta?: { page: number; totalPages: number; total: number; pageSize: number }; onPage: (p: number) => void }) {
  if (!meta) return null
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1
  const to = Math.min(meta.total, meta.page * meta.pageSize)
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <span>
        {from}–{to} / {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-8" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Trang trước">
          <ChevronLeft />
        </Button>
        <span className="px-2 tabular-nums">
          {meta.page}/{meta.totalPages}
        </span>
        <Button variant="outline" size="icon" className="size-8" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Trang sau">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Tìm kiếm…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
    </div>
  )
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">{children}</div>
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Xác nhận', destructive, pending, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel?: string; destructive?: boolean; pending?: boolean; onConfirm: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={pending} onClick={onConfirm}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{description}</p>
    </Dialog>
  )
}

export function KeyValue({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 text-sm break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} />
}
