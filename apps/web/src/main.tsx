import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobilfunk ist wackelig: lieber einmal automatisch nachladen, wenn die
      // App aus dem Hintergrund kommt, als veraltete Daten zu zeigen.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
