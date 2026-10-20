import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'
import { startAppUpdate } from './lib/appUpdate'
import { wurzelWorkerAnmelden } from './lib/legacyShare'
import { offlineStarten } from './lib/offline/start'
import { GERAET_GC_MS } from './lib/offline/zwischenspeicher'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobilfunk ist wackelig: lieber einmal automatisch nachladen, wenn die
      // App aus dem Hintergrund kommt, als veraltete Daten zu zeigen.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
      // Was einmal geladen war, bleibt im Speicher – sonst fiele es nach fünf
      // Minuten ohne Bildschirm heraus und damit auch aus dem Stand, den die
      // App fürs Arbeiten ohne Verbindung aufbewahrt.
      gcTime: GERAET_GC_MS,
    },
  },
})

// Vor dem ersten Zeichnen: Der Worker soll unabhängig davon anlaufen, was
// die App gerade anzeigt – auch der Anmeldebildschirm gehört dazu.
startAppUpdate()
// Für das Teilen aus einer Installation von vor dem Umzug (siehe dort).
wurzelWorkerAnmelden()

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')

// Erst den letzten Stand vom Gerät holen, dann zeichnen: So steht ohne
// Verbindung gleich die Einkaufsliste da und nicht „Server nicht erreichbar".
void offlineStarten('manager', queryClient).finally(() => {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
