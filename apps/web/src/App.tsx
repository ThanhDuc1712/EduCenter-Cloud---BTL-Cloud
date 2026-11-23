import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api-client'

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; database: string | undefined }
  | { kind: 'degraded'; database: string | undefined }
  | { kind: 'unreachable' }

/**
 * Foundation shell only: proves web → (Vite proxy) → api → database end to end.
 * Role-based layouts, router and TanStack Query arrive with P0-10 / P1-15 (TV2).
 */
function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })

  const check = useCallback(async () => {
    setHealth({ kind: 'loading' })
    try {
      const { data, error, response } = await api.GET('/health')
      if (data) setHealth({ kind: 'ok', database: data.checks.database })
      else if (response.status === 503 && error) setHealth({ kind: 'degraded', database: error.checks.database })
      else setHealth({ kind: 'unreachable' })
    } catch {
      setHealth({ kind: 'unreachable' })
    }
  }, [])

  useEffect(() => {
    // Initial probe on mount; state updates happen after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check()
  }, [check])

  const label: Record<HealthState['kind'], string> = {
    loading: 'Checking…',
    ok: 'API and database are up',
    degraded: 'API is up, database is down',
    unreachable: 'API unreachable',
  }
  const tone: Record<HealthState['kind'], string> = {
    loading: 'bg-muted-foreground',
    ok: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    unreachable: 'bg-destructive',
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">EduCenter Cloud</h1>
        <p className="text-muted-foreground">Local development foundation</p>
      </header>

      <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-xs">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3" role="status" aria-live="polite">
            <span className={`size-2.5 rounded-full ${tone[health.kind]}`} aria-hidden="true" />
            <span className="font-medium">{label[health.kind]}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void check()} disabled={health.kind === 'loading'}>
            Re-check
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          <code>GET /api/v1/health</code>
        </p>
      </section>
    </main>
  )
}

export default App
