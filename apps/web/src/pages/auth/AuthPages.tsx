import * as React from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CloudCog, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, Field, Input } from '@/components/ui/primitives'
import { Spinner } from '@/components/common'
import { api, ApiError } from '@/lib/api'
import { applyServerErrors, clean } from '@/lib/forms'
import { useAppContext, useAuthOptions, type AppContext } from '@/lib/context'
import { ROLE } from '@/lib/labels'

const tenantSlug = z.string().trim().regex(/^[a-z0-9-]{2,64}$/, 'Mã trung tâm gồm chữ thường, số, dấu -')
const email = z.string().trim().email('Email không hợp lệ').max(254)
const strongPassword = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(128)
  .regex(/\p{L}/u, 'Mật khẩu cần có chữ cái')
  .regex(/\d/, 'Mật khẩu cần có chữ số')

/** Only same-app relative paths are accepted as a post-login redirect (no open redirect). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') && !raw.startsWith('/register') ? raw : '/'
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white">
            <CloudCog className="size-5" />
          </span>
          <span className="text-lg font-semibold">EduCenter Cloud</span>
        </div>
        <Card>
          <CardContent className="space-y-5 p-6">
            <div>
              <h1 className="text-xl font-semibold">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {children}
          </CardContent>
        </Card>
        {footer ? <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p> : null}
      </div>
    </div>
  )
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

/** After login/register: drop every cached query of the previous identity, then seed the new context. */
function useSignedIn() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (ctx: AppContext, message: string) => {
    qc.clear()
    qc.setQueryData(['context'], ctx)
    toast.success(message)
    navigate(safeNext(params.get('next')), { replace: true })
  }
}

/** Already signed in with an account → no reason to show the auth pages. */
function useAlreadySignedIn(): boolean {
  const ctx = useAppContext()
  return ctx.data?.principal.authMethod === 'session'
}

const loginSchema = z.object({ tenantSlug, email, password: z.string().min(1, 'Nhập mật khẩu').max(128) })
type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const options = useAuthOptions()
  const signedIn = useSignedIn()
  const already = useAlreadySignedIn()
  const [params] = useSearchParams()
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { tenantSlug: '', email: '', password: '' } })
  const [formError, setFormError] = React.useState<string>()

  React.useEffect(() => {
    if (options.data && !form.getValues('tenantSlug')) form.setValue('tenantSlug', options.data.defaultTenantSlug)
  }, [options.data, form])

  const login = useMutation({
    mutationFn: (v: LoginValues) => api.post<AppContext>('/auth/login', v),
    onSuccess: (ctx) => signedIn(ctx, `Xin chào ${ctx.principal.displayName} (${ROLE[ctx.principal.role]})`),
    onError: (err) => {
      form.setValue('password', '')
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) setFormError(err.message)
      else applyServerErrors(err, form.setError)
    },
  })

  if (already) return <Navigate to={safeNext(params.get('next'))} replace />
  const e = form.formState.errors
  return (
    <AuthShell
      title="Đăng nhập"
      subtitle="Dùng tài khoản trung tâm cấp cho bạn hoặc tài khoản bạn đã đăng ký."
      footer={
        options.data?.registrationEnabled ? (
          <>
            Chưa có tài khoản?{' '}
            <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-medium text-primary hover:underline">
              Đăng ký học viên
            </Link>
          </>
        ) : undefined
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          setFormError(undefined)
          login.mutate(v)
        })}
      >
        {params.get('expired') ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.</p> : null}
        {formError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        ) : null}
        <Field label="Mã trung tâm" error={e.tenantSlug?.message}>
          <Input autoComplete="organization" {...form.register('tenantSlug')} />
        </Field>
        <Field label="Email" error={e.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Mật khẩu" error={e.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Spinner className="size-4" /> : null}
          Đăng nhập
        </Button>
        {options.data?.authMode === 'demo' ? (
          <p className="text-center text-xs text-muted-foreground">
            Máy chủ đang ở chế độ demo (AUTH_MODE=demo).{' '}
            <Link to="/" className="text-primary hover:underline">
              Vào không cần đăng nhập
            </Link>
          </p>
        ) : null}
      </form>
    </AuthShell>
  )
}

const registerSchema = z
  .object({
    tenantSlug,
    fullName: z.string().trim().min(2, 'Nhập họ tên').max(120),
    email,
    phone: z.string().trim().regex(/^[0-9+ .-]{8,20}$/, 'Số điện thoại không hợp lệ').or(z.literal('')),
    password: strongPassword,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Mật khẩu nhập lại không khớp' })
type RegisterValues = z.infer<typeof registerSchema>

export function RegisterPage() {
  const options = useAuthOptions()
  const signedIn = useSignedIn()
  const already = useAlreadySignedIn()
  const [params] = useSearchParams()
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), defaultValues: { tenantSlug: '', fullName: '', email: '', phone: '', password: '', confirm: '' } })

  React.useEffect(() => {
    if (options.data && !form.getValues('tenantSlug')) form.setValue('tenantSlug', options.data.defaultTenantSlug)
  }, [options.data, form])

  const register = useMutation({
    mutationFn: (v: RegisterValues) => api.post<AppContext>('/auth/register', clean({ tenantSlug: v.tenantSlug, fullName: v.fullName, email: v.email, phone: v.phone, password: v.password })),
    onSuccess: (ctx) => signedIn(ctx, `Đăng ký thành công. Chào mừng ${ctx.principal.displayName}!`),
    onError: (err) => applyServerErrors(err, form.setError),
  })

  if (already) return <Navigate to={safeNext(params.get('next'))} replace />
  if (options.isLoading) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  const loginLink = (
    <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-medium text-primary hover:underline">
      Đăng nhập
    </Link>
  )
  if (options.data && !options.data.registrationEnabled) {
    return (
      <AuthShell title="Đăng ký tài khoản" subtitle="Trung tâm hiện không mở đăng ký trực tuyến. Vui lòng liên hệ quản trị trung tâm để được cấp tài khoản." footer={<>Đã có tài khoản? {loginLink}</>}>
        <></>
      </AuthShell>
    )
  }
  const e = form.formState.errors
  return (
    <AuthShell title="Đăng ký học viên" subtitle="Tạo tài khoản học viên để xem lịch học, điểm, học phí và tài liệu." footer={<>Đã có tài khoản? {loginLink}</>}>
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => register.mutate(v))}>
        <Field label="Mã trung tâm" error={e.tenantSlug?.message}>
          <Input autoComplete="organization" {...form.register('tenantSlug')} />
        </Field>
        <Field label="Họ và tên *" error={e.fullName?.message}>
          <Input autoComplete="name" autoFocus {...form.register('fullName')} />
        </Field>
        <Field label="Email *" error={e.email?.message} hint="Dùng để đăng nhập">
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Điện thoại" error={e.phone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register('phone')} />
        </Field>
        <Field label="Mật khẩu *" error={e.password?.message} hint="Tối thiểu 8 ký tự, gồm cả chữ và số">
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Nhập lại mật khẩu *" error={e.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? <Spinner className="size-4" /> : null}
          Tạo tài khoản
        </Button>
      </form>
    </AuthShell>
  )
}
