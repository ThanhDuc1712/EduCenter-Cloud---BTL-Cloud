import * as React from 'react'

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/**
 * Page number that automatically returns to 1 whenever `filters` change — derived during render,
 * no effect (and no extra render with a stale page).
 */
export function usePage(filters: unknown): [number, (page: number) => void] {
  const key = JSON.stringify(filters)
  const [state, setState] = React.useState({ key, page: 1 })
  const page = state.key === key ? state.page : 1
  return [page, (p: number) => setState({ key, page: p })]
}
