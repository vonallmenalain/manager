import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { Detail } from './screens/Detail'
import { Library } from './screens/Library'
import { Shell } from './Shell'
import { UpdateBanner } from '../components/UpdateBanner'
import { DOCBASE_BASENAME } from '../lib/appScopes'
import { useSession } from '../lib/session'
import { BackendUnreachable } from '../screens/BackendUnreachable'
import { Login } from '../screens/Login'

/**
 * DocBase – die medizinische Sammlung.
 *
 * Eine eigene App, kein Reiter im Manager: Sie hat einen anderen Zweck (Wissen
 * nachschlagen statt Post erledigen), einen anderen Rhythmus (man sucht darin,
 * statt sie abzuarbeiten) und ein eigenes Symbol auf dem Startbildschirm. Vom
 * Manager aus führt bewusst kein einziger Weg hierher – wer sie öffnet, hat
 * sich dafür entschieden.
 *
 * Geteilt wird trotzdem alles, was darunter liegt: dieselbe Anmeldung,
 * derselbe Server, dieselbe Texterkennung, dieselbe Kamera. Ein zweites Konto
 * wäre ein zweites Passwort für dieselbe Person.
 */
export function App() {
  const { user, isLoading, needsSetup, connectionError, retry } = useSession()

  if (isLoading) return <SplashScreen />
  if (connectionError) return <BackendUnreachable onRetry={retry} />
  if (!user) {
    // Ohne Konto führt der Weg über den Manager: Die Ersteinrichtung legt den
    // Haushalt an, und die DocBase hängt daran. Hier stünde sonst ein zweiter
    // Einrichtungsbildschirm für dieselbe Datenbank.
    return needsSetup ? (
      <NeedsHousehold />
    ) : (
      <Login titel="DocBase" untertitel="Studien, Kurse, Notizen." zeichen="D" />
    )
  }

  return (
    // basename: Die App liegt unter /docbase, und alle Adressen darin sollen
    // ohne dieses Präfix geschrieben werden können.
    <BrowserRouter basename={DOCBASE_BASENAME}>
      <UpdateBanner />
      <Routes>
        <Route element={<Shell user={user} />}>
          <Route index element={<Library />} />
          <Route path=":id" element={<Detail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="grid size-16 animate-pulse place-items-center rounded-2xl bg-teal-700 text-3xl font-bold text-white">
        D
      </div>
    </div>
  )
}

function NeedsHousehold() {
  return (
    <div className="grid min-h-dvh place-items-center px-8 text-center">
      <div>
        <p className="font-medium">Noch kein Konto</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Die DocBase teilt sich die Anmeldung mit dem Manager. Dort einmal einrichten, danach
          geht es hier weiter.
        </p>
      </div>
    </div>
  )
}
