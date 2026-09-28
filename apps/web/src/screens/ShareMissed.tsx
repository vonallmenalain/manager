import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DOCBASE_SHARE_CACHE, SHARE_CACHE, SHARE_LANDING_ROUTE } from '../lib/shareConstants'
import { istLeer, readSharedContent } from '../lib/sharedContent'

/**
 * Das Teilen-Ziel, aufgerufen als gewöhnliche Seite – das Geteilte ist
 * unterwegs verloren gegangen.
 *
 * Android schickt Geteiltes als POST, und den fängt der Service Worker ab.
 * Kommt stattdessen diese Seite, war kein Worker da: Die App wurde eben erst
 * installiert oder aktualisiert, oder – beim Manager – sie stammt noch aus der
 * Zeit vor dem Umzug nach `/app/`. Bisher endete das wortlos auf der
 * Startseite, und man wusste nicht, wo die Datei geblieben war.
 *
 * Beim zweiten Mal klappt es in aller Regel: Mit dem Aufruf dieser Seite hat
 * sich der Worker angemeldet, auch der für alte Installationen (siehe
 * `lib/legacyShare.ts`).
 */
export function ShareMissed({ app }: { app: 'manager' | 'docbase' }) {
  const navigate = useNavigate()
  const name = app === 'docbase' ? 'DocBase' : 'Manager'
  const [geprueft, setGeprueft] = useState(false)

  // Liegt doch etwas bereit, geht es ohne Umweg zur Auswahl.
  useEffect(() => {
    void readSharedContent(app === 'docbase' ? DOCBASE_SHARE_CACHE : SHARE_CACHE).then(
      (content) => {
        if (!istLeer(content)) navigate(`/${SHARE_LANDING_ROUTE}`, { replace: true })
        else setGeprueft(true)
      },
    )
  }, [app, navigate])

  if (!geprueft) {
    return <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Geteilt an {name}</h1>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="font-medium">Das Geteilte ist nicht angekommen.</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Bitte in der anderen App nochmals auf Teilen tippen und {name} wählen – beim zweiten Mal
          klappt es in der Regel.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Kommt auch dann nichts an: {name} vom Startbildschirm entfernen und im Browser neu
          installieren. Danach steht die App frisch im Teilen-Menü.
        </p>
      </div>
      <button
        onClick={() => navigate('/', { replace: true })}
        className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
      >
        Zur Startseite
      </button>
    </div>
  )
}
