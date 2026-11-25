import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ApiError } from '@/lib/api'
import type { AppContext } from '@/lib/context'
import './index.css'
import App from './App.tsx'

/**
 * A 401 while signed in means the session expired or was revoked (logout elsewhere, password
 * change): leave for the login page with a full reload, which also drops every cached query.
 */
function onApiError(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return
  if (/^\/(login|register)(\/|$)/.test(window.location.pathname)) return
  const ctx = queryClient.getQueryData<AppContext>(['context'])
  if (ctx?.principal.authMethod !== 'session') return // first visit: AppLayout redirects
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.assign(`/login?expired=1&next=${next}`)
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Do not hammer the API on 4xx (validation, 403, 404): only retry transient failures.
      retry: (count, err) => count < 2 && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
