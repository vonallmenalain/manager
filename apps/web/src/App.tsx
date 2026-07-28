import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { CoinIcon } from './components/icons'
import { useSession } from './lib/session'
import { BackendUnreachable } from './screens/BackendUnreachable'
import { Dashboard } from './screens/Dashboard'
import { DocumentDetail } from './screens/DocumentDetail'
import { Documents } from './screens/Documents'
import { Login } from './screens/Login'
import { Notes } from './screens/Notes'
import { Placeholder } from './screens/Placeholder'
import { Setup } from './screens/Setup'
import { Shopping } from './screens/Shopping'

export function App() {
  const { user, isLoading, needsSetup, connectionError, retry } = useSession()

  if (isLoading) return <SplashScreen />
  // Vor der Anmeldung prüfen: Ohne Backend ist jede Eingabe zwecklos, und
  // die Anmeldemaske würde den Fehler dem Passwort zuschieben.
  if (connectionError) return <BackendUnreachable onRetry={retry} />
  if (!user) return needsSetup ? <Setup /> : <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell user={user} />}>
          <Route index element={<Dashboard user={user} />} />
          <Route path="dokumente" element={<Documents />} />
          <Route path="dokumente/:id" element={<DocumentDetail />} />
          <Route path="einkauf" element={<Shopping />} />
          <Route path="notizen" element={<Notes />} />
          <Route
            path="finanzen"
            element={
              <Placeholder
                title="Finanzen"
                stage={5}
                description="Einkommen pro Monat, Steuerabzug, Zehnten und Fastopfer abrechnen."
                icon={<CoinIcon className="size-8" />}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="grid size-16 animate-pulse place-items-center rounded-2xl bg-brand-800 text-3xl font-bold text-white">
        M
      </div>
    </div>
  )
}
