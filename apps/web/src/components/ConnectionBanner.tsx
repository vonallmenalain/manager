import { useEffect, useState } from 'react'

import { useServerErreichbar } from '../lib/offline/verbindung'
import { meldungQuittieren, useWarteschlange } from '../lib/offline/warteschlange'

/**
 * Zeigt an, wenn keine Verbindung besteht – und was das heisst.
 *
 * Ohne diesen Hinweis wirkt die App im Funkloch schlicht kaputt, oder sie
 * zeigt einen alten Stand, ohne dass man es merkt. Seit die App ohne
 * Verbindung weiterarbeitet, sagt der Hinweis auch, was geht: Einkaufsliste
 * und Notizen lassen sich bearbeiten, alles andere zeigt den letzten Stand.
 * Und wie viele Änderungen noch auf dem Gerät warten.
 *
 * Zwei Arten von „keine Verbindung": Das Gerät hat gar kein Netz – oder es
 * hat eines, aber der Server antwortet nicht (Funkloch mit Balken, NAS im
 * Neustart). Für die Arbeit ist beides dasselbe; gesagt wird, was zutrifft.
 */
export function ConnectionBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const erreichbar = useServerErreichbar()
  const { offen, meldung } = useWarteschlange()

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (meldung) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
      >
        <p className="min-w-0 flex-1">{meldung}</p>
        <button
          onClick={meldungQuittieren}
          aria-label="Meldung schliessen"
          className="grid size-8 shrink-0 place-items-center rounded-lg"
        >
          ✕
        </button>
      </div>
    )
  }

  if (online && erreichbar) return null

  const wartend =
    offen === 0 ? '' : offen === 1 ? ' · 1 Änderung wartet' : ` · ${offen} Änderungen warten`

  return (
    <div
      role="status"
      className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span className="font-medium">{online ? 'Server nicht erreichbar' : 'Keine Verbindung'}</span>{' '}
      – Einkauf und Notizen gehen weiter und werden später übertragen, sonst gilt der letzte Stand.
      <span className="font-medium">{wartend}</span>
    </div>
  )
}
