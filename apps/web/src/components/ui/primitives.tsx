import * as React from 'react'
import { Dialog as D, Tabs as T } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/labels'

// ───── Card ─────
export function Card({ className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-xs', className)} {...p} />
}
export function CardHeader({ className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-2', className)} {...p} />
}
export function CardTitle({ className, ...p }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm font-semibold', className)} {...p} />
}
export function CardContent({ className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...p} />
}

// ───── Form controls ─────
const field = 'h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, className)} {...p} />)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'h-auto min-h-20 py-2', className)} {...p} />)
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'pr-8', className)} {...p} />)
Select.displayName = 'Select'

export function Label({ className, ...p }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...p} />
}

/** Label + control + validation message. */
export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

// ───── Badge ─────
const TONES: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  muted: 'bg-muted text-muted-foreground ring-border',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}
export function Badge({ tone = 'neutral', className, ...p }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-transparent', TONES[tone], className)} {...p} />
}

// ───── Table ─────
export function Table({ className, ...p }: React.ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
    </div>
  )
}
export const THead = (p: React.ComponentProps<'thead'>) => <thead className="border-b bg-muted/50 text-xs text-muted-foreground" {...p} />
export const TBody = (p: React.ComponentProps<'tbody'>) => <tbody className="divide-y" {...p} />
export function Th({ className, ...p }: React.ComponentProps<'th'>) {
  return <th className={cn('h-9 px-3 text-left font-medium whitespace-nowrap', className)} {...p} />
}
export function Td({ className, ...p }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...p} />
}
export function Tr({ className, ...p }: React.ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-muted/40', className)} {...p} />
}

// ───── Dialog ─────
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content className={cn('fixed top-1/2 left-1/2 z-50 flex max-h-[90svh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-background shadow-lg data-[state=open]:animate-in data-[state=open]:zoom-in-95', width)}>
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Đóng">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

// ───── Tabs ─────
export function Tabs({ value, onValueChange, tabs, children }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: React.ReactNode }[]; children: React.ReactNode }) {
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      <T.List className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {tabs.map((t) => (
          <T.Trigger key={t.value} value={t.value} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground">
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  )
}
export const TabPanel = ({ value, children }: { value: string; children: React.ReactNode }) => <T.Content value={value}>{children}</T.Content>

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
