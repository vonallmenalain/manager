import { dehydrate, hydrate, type Query, type QueryClient } from '@tanstack/react-query'

import { allesLoeschen, lesen, schreiben, speicherName } from './speicher'

/**
 * Was die App zuletzt vom Server bekommen hat – auf dem Gerät aufbewahrt.
 *
 * Ohne Verbindung startet die App mit diesem Stand: angemeldet, mit der
 * Einkaufsliste, den Notizen, den Dokumenten, den Finanzen – so, wie sie beim
 * letzten Mal dastanden. Mit Verbindung ist er nach einem Augenblick durch den
 * frischen ersetzt; bis dahin sieht man statt eines leeren Bildschirms den
 * letzten Stand.
 *
 * Aufbewahrt werden nur Listen und Angaben, keine Dateien: Vorschaubilder
 * und Bilder in Notizen hält der Service Worker (siehe `dateienImWorker`),
 * und eine Suche nach „mil" muss niemand offline wiederfinden.
 */

const SCHLUESSEL = 'abfragen'

/**
 * Erhöhen, wenn sich die Form der Daten so ändert, dass ein alter Stand die
 * neue App durcheinanderbrächte. Dann beginnt sie einmal ohne – mit
 * Verbindung merkt das niemand.
 */
const FASSUNG = 1

/** Älter darf ein Stand nicht sein, um noch angezeigt zu werden. */
const HOECHSTENS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * So lange bleiben geladene Daten im Speicher der App (`gcTime`). Mit den
 * üblichen fünf Minuten fiele eine Liste, die man eine Weile nicht anschaut,
 * aus dem Speicher und beim nächsten Aufbewahren auch vom Gerät.
 *
 * Eine Woche und nicht die ganze Frist: Der Zeitgeber dahinter verträgt
 * höchstens gut 24 Tage, und länger bleibt kaum eine App offen – beim
 * nächsten Start kommt ohnehin alles vom Gerät zurück.
 */
export const GERAET_GC_MS = 7 * 24 * 60 * 60 * 1000

/** Wie lange nach einer Änderung gewartet wird, bevor gespeichert wird. */
const PAUSE_MS = 1000

/** Welche Abfragen aufbewahrt werden – nach dem ersten Teil ihres Schlüssels. */
const AUFBEWAHREN = new Set([
  'session',
  'shopping',
  'shopping-sections',
  'notes',
  'documents',
  'document',
  'categories',
  'users',
  'preview',
  'note-file-preview',
  'finanzen',
  'hypothek',
  'haus',
])

function aufbewahren(query: Query): boolean {
  if (query.state.status !== 'success') return false
  const [erster, filter] = query.queryKey as [unknown, unknown]
  if (typeof erster !== 'string' || !AUFBEWAHREN.has(erster)) return false
  // Suchen nicht: Jeder Tastendruck wäre eine eigene Liste.
  if (filter && typeof filter === 'object' && 'q' in filter && (filter as { q?: unknown }).q) {
    return false
  }
  return true
}

interface Gespeichert {
  fassung: number
  zeit: number
  stand: ReturnType<typeof dehydrate>
}

/** Den aufbewahrten Stand in die App holen – vor dem ersten Zeichnen. */
export async function abfragenWiederherstellen(queryClient: QueryClient): Promise<void> {
  const gespeichert = await lesen<Gespeichert>(SCHLUESSEL)
  if (!gespeichert || gespeichert.fassung !== FASSUNG) return
  if (Date.now() - gespeichert.zeit > HOECHSTENS_MS) return
  try {
    hydrate(queryClient, gespeichert.stand)
  } catch {
    // Ein unlesbarer Stand ist kein Grund, nicht zu starten.
  }
}

let timer: number | undefined
let angehalten = false

function jetztSpeichern(queryClient: QueryClient): void {
  if (angehalten) return
  const stand = dehydrate(queryClient, { shouldDehydrateQuery: aufbewahren })
  void schreiben(SCHLUESSEL, { fassung: FASSUNG, zeit: Date.now(), stand } satisfies Gespeichert)
}

/** Ab jetzt jede Änderung der Daten aufbewahren – gebündelt, nicht bei jedem Tastendruck. */
export function abfragenAufbewahren(queryClient: QueryClient): void {
  queryClient.getQueryCache().subscribe((ereignis) => {
    if (ereignis.type !== 'updated' && ereignis.type !== 'removed') return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => jetztSpeichern(queryClient), PAUSE_MS)
  })
  // Bevor die App in den Hintergrund geht, sofort – danach kann sie jederzeit
  // beendet werden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    window.clearTimeout(timer)
    jetztSpeichern(queryClient)
  })
}

/**
 * Beim Abmelden: alles vom Gerät nehmen – Daten, Warteschlange und Bilder,
 * in beiden Apps. Wer sich abmeldet, will danach nichts mehr auf dem Handy
 * finden, das ohne Anmeldung zu lesen wäre.
 */
export async function geraetLeeren(): Promise<void> {
  angehalten = true
  window.clearTimeout(timer)
  await allesLoeschen()
  // Die eigene Datenbank ist offen und wird geleert; die der anderen App ganz
  // gelöscht – abgemeldet ist man in beiden, sie teilen sich die Anmeldung.
  for (const name of ['manager-offline', 'docbase-offline']) {
    if (name === speicherName()) continue
    try {
      indexedDB.deleteDatabase(name)
    } catch {
      // Dann eben beim nächsten Mal.
    }
  }
  try {
    for (const name of await caches.keys()) {
      if (/-(vorschauen|dateien)$/.test(name)) await caches.delete(name)
    }
  } catch {
    // Ohne Cache Storage gibt es dort auch nichts zu löschen.
  }
  angehalten = false
}
