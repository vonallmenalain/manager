import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import '../index.css'
import { startAppUpdate } from '../lib/appUpdate'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Wie beim Manager: Der Worker läuft an, bevor irgendetwas gezeichnet wird.
startAppUpdate()

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
