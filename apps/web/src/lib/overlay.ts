import { useEffect } from 'react'

/**
 * Meldet an, dass eine bildschirmfüllende Fläche offen ist.
 *
 * Setzt `data-flaeche` am <html>; die Regeln dazu stehen in index.css. Gezählt
 * wird, weil sich Scanner und Seitenstapel beim Wechsel kurz überlappen – ohne
 * Zähler würde der eine beim Schliessen aufräumen, was der andere gerade
 * angemeldet hat, und die Navigationsleiste käme mitten im Scannen zurück.
 */
/**
 * Schliesst mit der Escape-Taste, solange etwas offen ist.
 *
 * Für Menüs, die kein Fenster über sich haben: Dort genügt der Griff daneben
 * nicht als einziger Ausweg – wer mit der Tastatur arbeitet, erwartet Escape.
 * Innerhalb eines Fensters wird die Taste bewusst nicht hier abgefangen,
 * sonst schlösse sie beides auf einmal.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onEscape()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}

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
