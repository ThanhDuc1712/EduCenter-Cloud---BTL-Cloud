import * as React from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bell, ChevronDown, ChevronRight, CloudCog, KeyRound, LogOut, Menu, UserCog, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge, Dialog, Field, Input } from '@/components/ui/primitives'
import { SearchBox, Spinner } from '@/components/common'
import { useDebounced } from '@/lib/hooks'
import { api, ApiError, errorMessage } from '@/lib/api'
import { applyServerErrors } from '@/lib/forms'
import { useAppContext, type AppContext, type Role } from '@/lib/context'
import { ROLE } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { NAV, titleFor } from './nav'

function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Điều hướng chính">
      {NAV.map((g) => {
        const items = g.items.filter((i) => i.roles.includes(role))
        if (!items.length) return null
        return (
          <div key={g.label}>
            <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{g.label}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/' || i.to === '/cloud' || i.to === '/materials'}
                    onClick={onNavigate}
                    className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/85 transition hover:bg-sidebar-accent hover:text-white', isActive && 'bg-sidebar-accent font-medium text-white')}
                  >
                    <i.icon className="size-4 shrink-0 opacity-80" />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

interface Persona {
  personaKey: string
  role: Role
  displayName: string
  detail: string
}

function PersonaSwitcher({ ctx }: { ctx: AppContext }) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const dq = useDebounced(q)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const personas = useQuery({ queryKey: ['personas', dq], queryFn: () => api.get<{ items: Persona[] }>('/context/personas', { q: dq }), enabled: open && ctx.demoMode })
  const sw = useMutation({
    mutationFn: (personaKey: string) => api.put<AppContext>('/context', { personaKey }),
    onSuccess: async (res) => {
      setOpen(false)
      qc.clear()
      await qc.invalidateQueries()
      navigate('/')
      toast.success(`Đang xem với vai trò ${ROLE[res.principal.role]}: ${res.principal.displayName}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <>
      <button onClick={() => ctx.demoMode && setOpen(true)} className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted" title={ctx.demoMode ? 'Chuyển vai trò demo' : 'Ngữ cảnh do máy chủ cấu hình'}>
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{ctx.principal.displayName.split(' ').slice(-1)[0]?.slice(0, 2).toUpperCase()}</span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[180px] truncate text-sm font-medium">{ctx.principal.displayName}</span>
          <span className="block text-xs text-muted-foreground">{ROLE[ctx.principal.role]}</span>
        </span>
        {ctx.demoMode ? <UserCog className="size-4 text-muted-foreground" /> : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Chuyển vai trò demo" description="Chế độ demo (AUTH_MODE=demo): máy chủ xác định vai trò từ hồ sơ demo đã seed. Chỉ khả dụng khi DEMO_MODE=true.">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm giáo viên / học viên theo tên hoặc mã" className="mb-3 sm:w-full" />
        {personas.isLoading ? (
          <Spinner />
        ) : (
          <ul className="max-h-[50svh] divide-y overflow-y-auto rounded-md border">
            {personas.data?.items.map((p) => (
              <li key={p.personaKey}>
                <button className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted', p.personaKey === ctx.principal.personaKey && 'bg-primary/5')} disabled={sw.isPending} onClick={() => sw.mutate(p.personaKey)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.detail}</span>
                  </span>
                  <Badge tone={p.role === 'ADMIN' ? 'danger' : p.role === 'TEACHER' ? 'info' : 'success'}>{ROLE[p.role]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  )
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(128).regex(/\p{L}/u, 'Mật khẩu cần có chữ cái').regex(/\d/, 'Mật khẩu cần có chữ số'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Mật khẩu nhập lại không khớp' })
type PasswordValues = z.infer<typeof passwordSchema>

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } })
  const change = useMutation({
    mutationFn: (v: PasswordValues) => api.post<void>('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      toast.success('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.')
      form.reset()
      onOpenChange(false)
    },
    onError: (err) => applyServerErrors(err, form.setError),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Đổi mật khẩu"
      description="Sau khi đổi, mọi phiên đăng nhập khác của tài khoản sẽ bị thu hồi."
      size="sm"
      footer={
        <Button type="submit" form="change-password-form" disabled={change.isPending}>
          Lưu mật khẩu
        </Button>
      }
    >
      <form id="change-password-form" className="space-y-3" noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
        <Field label="Mật khẩu hiện tại" error={e.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="Mật khẩu mới" error={e.newPassword?.message} hint="Tối thiểu 8 ký tự, gồm cả chữ và số">
          <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Nhập lại mật khẩu mới" error={e.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
      </form>
    </Dialog>
  )
}

/** Signed-in account: name/role, change password, logout. */
function AccountMenu({ ctx }: { ctx: AppContext }) {
  const [open, setOpen] = React.useState(false)
  const [pwOpen, setPwOpen] = React.useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const close = (ev: MouseEvent) => ref.current && !ref.current.contains(ev.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const logout = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      qc.clear()
      navigate('/login', { replace: true })
      toast.success('Đã đăng xuất')
    },
  })
  const p = ctx.principal
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{p.displayName.split(' ').slice(-1)[0]?.slice(0, 2).toUpperCase()}</span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[180px] truncate text-sm font-medium">{p.displayName}</span>
          <span className="block text-xs text-muted-foreground">{ROLE[p.role]}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-60 rounded-md border bg-background p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{p.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{p.email}</p>
            <p className="truncate text-xs text-muted-foreground">{p.tenantName}</p>
          </div>
          <div className="my-1 border-t" />
          <button role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted" onClick={() => { setOpen(false); setPwOpen(true) }}>
            <KeyRound className="size-4" /> Đổi mật khẩu
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-destructive hover:bg-muted" disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut className="size-4" /> Đăng xuất
          </button>
        </div>
      ) : null}
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  )
}

function NotificationBell() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unreadCount: number }>('/notifications/unread-count'), refetchInterval: 30_000 })
  const n = q.data?.unreadCount ?? 0
  return (
    <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/notifications')} aria-label={`Thông báo (${n} chưa đọc)`}>
      <Bell />
      {n > 0 ? <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">{n > 99 ? '99+' : n}</span> : null}
    </Button>
  )
}

export function AppLayout() {
  const ctx = useAppContext()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const crumb = titleFor(location.pathname)

  if (ctx.isLoading) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (ctx.error instanceof ApiError && ctx.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  if (ctx.isError || !ctx.data) {
    return (
      <div className="grid min-h-svh place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Không kết nối được EduCenter API</p>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage(ctx.error)}</p>
          <p className="mt-3 text-sm text-muted-foreground">Kiểm tra API (cổng 3000) và cơ sở dữ liệu — xem docs/local-development.md.</p>
          <Button className="mt-4" onClick={() => ctx.refetch()}>
            Thử lại
          </Button>
        </div>
      </div>
    )
  }
  const { principal, mode } = ctx.data
  const cloudMode = mode.storage === 'oss' || mode.processing === 'aliyun-fc'

  const brand = (
    <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
        <CloudCog className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">EduCenter Cloud</p>
        <p className="truncate text-[11px] text-sidebar-muted">{principal.tenantName}</p>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col bg-sidebar lg:flex">
        {brand}
        <Sidebar role={principal.role} />
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-sidebar-muted">
          Chế độ: <span className="font-semibold text-white">{cloudMode ? 'CLOUD' : 'LOCAL'}</span> · storage {mode.storage.toUpperCase()} · xử lý {mode.processing === 'local' ? 'LOCAL (MOCK)' : 'Function Compute'}
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-sidebar">
            <button className="absolute top-4 right-3 text-white" onClick={() => setMobileOpen(false)} aria-label="Đóng menu">
              <X className="size-5" />
            </button>
            {brand}
            <Sidebar role={principal.role} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Mở menu">
            <Menu />
          </Button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            {crumb.group ? (
              <>
                <span className="hidden truncate sm:inline">{crumb.group}</span>
                <ChevronRight className="hidden size-3.5 sm:inline" />
              </>
            ) : null}
            <span className="truncate font-medium text-foreground">{crumb.label}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {ctx.data.demoMode ? <Badge tone="warning">DEMO</Badge> : null}
            <Badge tone={cloudMode ? 'info' : 'violet'}>{cloudMode ? 'CLOUD MODE' : 'LOCAL MODE'}</Badge>
            <NotificationBell />
            {principal.authMethod === 'session' ? (
              <AccountMenu ctx={ctx.data} />
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => navigate('/login')}>
                  Đăng nhập
                </Button>
                <PersonaSwitcher ctx={ctx.data} />
              </>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
