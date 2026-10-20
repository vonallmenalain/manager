import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import '../index.css'
import { startAppUpdate } from '../lib/appUpdate'
import { offlineStarten } from '../lib/offline/start'
import { GERAET_GC_MS } from '../lib/offline/zwischenspeicher'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
      // Wie beim Manager: Geladenes bleibt, damit es offline da ist.
      gcTime: GERAET_GC_MS,
    },
  },
})

// Wie beim Manager: Der Worker läuft an, bevor irgendetwas gezeichnet wird.
startAppUpdate()

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')

// Wie beim Manager: erst der letzte Stand vom Gerät, dann das erste Bild.
void offlineStarten('docbase', queryClient).finally(() => {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
