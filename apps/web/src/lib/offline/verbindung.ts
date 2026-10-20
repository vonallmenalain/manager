import { useSyncExternalStore } from 'react'

/**
 * Ob der Server gerade antwortet.
 *
 * Der Browser meldet nur, ob das Gerät irgendein Netz hat (`navigator.onLine`).
 * Im Laden mit einem Balken Empfang, im Zug zwischen zwei Masten oder wenn
 * das NAS zu Hause neu startet, sagt er „online" – und trotzdem kommt nichts
 * an. Deshalb merkt sich die App selbst, ob die letzte Anfrage durchkam, und
 * fragt in kurzen Abständen nach, solange sie es nicht tat. Kommt der Server
 * zurück, holen die Listen ihren Stand und die Warteschlange schickt ab.
 */

const PRUEFEN_MS = 15_000

/**
 * Antworten, hinter denen nicht der Server steht, sondern der Weg dorthin:
 * Cloudflare meldet so einen Tunnel ohne Gegenstelle, ein Proxy einen
 * Server, der nicht antwortet.
 */
const WEG_FEHLT = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530])

export function istWegFehler(status: number): boolean {
  return WEG_FEHLT.has(status)
}

/**
 * Kam die Anfrage gar nicht erst an? Dann lohnt es sich, sie später nochmals
 * zu versuchen – anders als bei einer Antwort, die „nein" sagt.
 */
export function istVerbindungsfehler(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status === 0 || istWegFehler(status)
  // Kein Fehler der API (etwa ein abgebrochener Aufruf): lieber nochmals.
  return true
}

let erreichbar = true
let timer: number | undefined
let pruefen: (() => Promise<unknown>) | null = null
let beiRueckkehr: (() => void) | null = null
const zuhoerer = new Set<() => void>()

export function verbindungEinrichten(optionen: {
  /** Eine kleine Anfrage, an der sich zeigt, ob der Server antwortet. */
  pruefen: () => Promise<unknown>
  /** Was geschieht, wenn er wieder antwortet. */
  beiRueckkehr: () => void
}): void {
  pruefen = optionen.pruefen
  beiRueckkehr = optionen.beiRueckkehr
  window.addEventListener('online', () => {
    if (!erreichbar) void nachfragen()
  })
}

async function nachfragen(): Promise<void> {
  if (!pruefen || erreichbar) return
  if (navigator.onLine === false) return
  // Das Ergebnis meldet die Anfrage selbst (siehe `request` in api.ts).
  await pruefen().catch(() => undefined)
}

/** Von jeder Anfrage gerufen: Kam sie durch oder nicht? */
export function meldeVerbindung(ok: boolean): void {
  if (ok === erreichbar) return
  erreichbar = ok
  for (const rueckruf of zuhoerer) rueckruf()
  if (ok) {
    window.clearInterval(timer)
    timer = undefined
    beiRueckkehr?.()
  } else if (timer === undefined) {
    timer = window.setInterval(() => void nachfragen(), PRUEFEN_MS)
  }
}

function abonnieren(rueckruf: () => void): () => void {
  zuhoerer.add(rueckruf)
  return () => zuhoerer.delete(rueckruf)
}

/** Antwortet der Server? – für den Hinweis oben. */
export function useServerErreichbar(): boolean {
  return useSyncExternalStore(abonnieren, () => erreichbar)
}
