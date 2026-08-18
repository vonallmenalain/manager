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

/**
 * Meldet etwas Offenes am <html> an und wieder ab.
 *
 * Gezählt wird, weil sich zwei davon überlappen können – Scanner und
 * Seitenstapel beim Wechsel, Kategorienfilter und das Fenster „Neue
 * Kategorie" darüber. Ohne Zähler räumte das eine beim Schliessen auf, was
 * das andere gerade angemeldet hat.
 */
function melde(schluessel: 'flaeche' | 'menue'): () => void {
  const root = document.documentElement
  root.dataset[schluessel] = String(Number(root.dataset[schluessel] ?? '0') + 1)

  return () => {
    const rest = Number(root.dataset[schluessel] ?? '1') - 1
    if (rest > 0) root.dataset[schluessel] = String(rest)
    else delete root.dataset[schluessel]
  }
}

export function useFullScreenOverlay(): void {
  useEffect(() => melde('flaeche'), [])
}

/**
 * Meldet an, dass ein Menü aufgeklappt ist.
 *
 * Anders als eine bildschirmfüllende Fläche verdeckt ein Menü die Seite nicht
 * – es legt sich nur über einen Teil davon. Genau deshalb braucht es die
 * Anmeldung: Der runde Knopf unten rechts liegt fest am Bildschirmrand und
 * schöbe sich sonst vor die untersten Einträge. Auf einem kurzen Bildschirm
 * traf das „Auswahl zurücksetzen" – die Regel dazu steht in index.css.
 */
export function useOpenPanel(): void {
  useEffect(() => melde('menue'), [])
}
