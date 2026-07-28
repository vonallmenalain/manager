import { Button } from '../components/Button'
import { API_BASE } from '../lib/api'
import { Logo } from './Login'

/**
 * Erscheint, wenn das Backend gar nicht antwortet.
 *
 * Ohne diesen Bildschirm landet man auf der Anmeldung und hält sein Passwort
 * für falsch, obwohl die Anfrage nie beim Server ankam. Entscheidend ist die
 * angezeigte Adresse: Steht dort etwas anderes als erwartet, ist die
 * Ursache sofort klar, ohne die Entwicklerwerkzeuge zu öffnen.
 */
export function BackendUnreachable({ onRetry }: { onRetry: () => void }) {
  const usesLocalhost = API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm text-center">
        <Logo />
        <h1 className="mt-4 text-2xl font-bold">Server nicht erreichbar</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Die App konnte das Backend nicht erreichen. Angemeldet werden kann sie deshalb nicht.
        </p>

        <dl className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-left text-sm dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-slate-500 dark:text-slate-400">Versuchte Adresse</dt>
          <dd className="mt-1 break-all font-mono text-xs">{API_BASE}</dd>
        </dl>

        {usesLocalhost ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            Die Adresse zeigt auf diesen Rechner statt auf den Server. In den
            Netlify-Einstellungen fehlt die Variable <code>VITE_API_URL</code> – sie muss
            gesetzt und anschliessend neu veröffentlicht werden, weil der Wert beim Bauen
            fest eingetragen wird.
          </p>
        ) : (
          <p className="mt-4 text-left text-sm text-slate-500 dark:text-slate-400">
            Prüfen: Läuft der Container auf dem NAS, ist der Cloudflare-Tunnel verbunden,
            und stimmt <code>APP_ORIGIN</code> mit der Adresse dieser Seite überein?
          </p>
        )}

        <div className="mt-6">
          <Button onClick={onRetry}>Nochmals versuchen</Button>
        </div>
      </div>
    </div>
  )
}
