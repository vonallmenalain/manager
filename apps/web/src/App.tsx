import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { MANAGER_BASENAME } from './lib/appScopes'
import { useSession } from './lib/session'
import { SHARE_LANDING_ROUTE } from './lib/shareConstants'
import { BackendUnreachable } from './screens/BackendUnreachable'
import { Dashboard } from './screens/Dashboard'
import { DocumentDetail } from './screens/DocumentDetail'
import { Documents } from './screens/Documents'
import { Finance } from './screens/Finance'
import { Haus } from './screens/Haus'
import { Login } from './screens/Login'
import { Notes } from './screens/Notes'
import { Setup } from './screens/Setup'
import { Share } from './screens/Share'
import { Shopping } from './screens/Shopping'

export function App() {
  const { user, isLoading, needsSetup, connectionError, retry } = useSession()

  if (isLoading) return <SplashScreen />
  // Vor der Anmeldung prüfen: Ohne Backend ist jede Eingabe zwecklos, und
  // die Anmeldemaske würde den Fehler dem Passwort zuschieben.
  if (connectionError) return <BackendUnreachable onRetry={retry} />
  if (!user) return needsSetup ? <Setup /> : <Login />

  return (
    // basename: Die App liegt unter /app, und alle Adressen darin sollen ohne
    // dieses Präfix geschrieben werden können.
    <BrowserRouter basename={MANAGER_BASENAME}>
      <Routes>
        <Route element={<AppShell user={user} />}>
          <Route index element={<Dashboard user={user} />} />
          <Route path="dokumente" element={<Documents />} />
          <Route path="dokumente/:id" element={<DocumentDetail />} />
          <Route path="einkauf" element={<Shopping />} />
          <Route path="notizen" element={<Notes />} />
          <Route path="finanzen" element={<Finance />} />
          <Route path="haus" element={<Haus />} />
          {/* Wo das Android-Teilen-Menü landet. Die Adresse steht in
              shareConstants, weil der Service Worker hierher weiterleitet –
              zwei Schreibweisen liessen das Teilen ins Leere laufen. */}
          <Route path={SHARE_LANDING_ROUTE} element={<Share />} />
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
