import { useEffect, useState } from 'react'

/**
 * Zeigt an, wenn keine Verbindung besteht.
 *
 * Ohne diesen Hinweis wirkt die App im Funkloch schlicht kaputt: Die Hülle
 * kommt aus dem Zwischenspeicher und lädt, aber jede Aktion scheitert mit
 * einer Fehlermeldung, deren Ursache man nicht sieht.
 */
export function ConnectionBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

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

  if (online) return null

  return (
    <div
      role="status"
      className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      Keine Verbindung – Änderungen sind erst wieder online möglich.
    </div>
  )
}
