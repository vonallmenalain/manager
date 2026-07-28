import { useEffect } from 'react'

/**
 * Meldet an, dass eine bildschirmfüllende Fläche offen ist.
 *
 * Setzt `data-flaeche` am <html>; die Regeln dazu stehen in index.css. Gezählt
 * wird, weil sich Scanner und Seitenstapel beim Wechsel kurz überlappen – ohne
 * Zähler würde der eine beim Schliessen aufräumen, was der andere gerade
 * angemeldet hat, und die Navigationsleiste käme mitten im Scannen zurück.
 */
export function useFullScreenOverlay(): void {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.flaeche = String(Number(root.dataset.flaeche ?? '0') + 1)

    return () => {
      const remaining = Number(root.dataset.flaeche ?? '1') - 1
      if (remaining > 0) root.dataset.flaeche = String(remaining)
      else delete root.dataset.flaeche
    }
  }, [])
}
