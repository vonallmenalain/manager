import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

import type { TexterkennungStatus } from '@manager/shared'
import type { FastifyBaseLogger } from 'fastify'

import { env } from '../env.js'
import { extractText, KeinTextError, resolveLanguages, tidyText } from './extract.js'

/**
 * Texterkennung auf Abruf – für „Text erkennen und einfügen" in einer Notiz.
 *
 * Anders als bei den Dokumenten gibt es hier nichts abzulegen: Die Datei wird
 * gelesen, ihr Text geht an die App zurück, und die Datei ist wieder weg.
 * Trotzdem kein einzelner Aufruf, der wartet, bis alles fertig ist – ein Foto
 * braucht auf dem NAS schnell eine halbe Minute, ein gescanntes PDF mit
 * vielen Seiten mehrere. So lange hält Cloudflare eine Anfrage nicht offen
 * (nach hundert Sekunden ist Schluss). Deshalb ein Auftrag: Hochladen gibt
 * eine Kennung zurück, und die App fragt nach, bis der Text da ist.
 *
 * Die Aufträge leben nur im Speicher. Ein Neustart des Servers verliert die
 * laufenden – die App meldet das und man versucht es nochmals; für ein paar
 * Aufträge am Tag wäre eine Tabelle dafür reine Bürokratie.
 */

export interface Auftrag {
  id: string
  userId: string
  status: TexterkennungStatus
  text?: string
  fehler?: string
  erstellt: number
}

/** So lange bleibt ein erledigter Auftrag abholbar. */
const AUFBEWAHRUNG_MS = 15 * 60 * 1000

const auftraege = new Map<string, Auftrag>()

/**
 * Einer nach dem anderen: Die Erkennung belegt einen Prozessorkern voll, und
 * nebenher liest der Worker die Dokumente. Zwei Fotos gleichzeitig wären
 * nicht schneller fertig, nur beide später.
 */
let kette: Promise<void> = Promise.resolve()

let sprachen: Promise<string> | null = null

/**
 * Die Sprachen für Tesseract, einmal ermittelt. Fehlt Tesseract, bleibt es bei
 * der Einstellung: Ein PDF mit Textebene kommt ohne aus, und ein Foto
 * scheitert dann mit einer Meldung statt schon beim Start.
 */
function sprachenErmitteln(): Promise<string> {
  sprachen ??= resolveLanguages(env.OCR_LANGUAGES).catch(() => env.OCR_LANGUAGES)
  return sprachen
}

function aufraeumen(): void {
  const grenze = Date.now() - AUFBEWAHRUNG_MS
  for (const [id, auftrag] of auftraege) {
    if (auftrag.erstellt < grenze && (auftrag.status === 'fertig' || auftrag.status === 'fehler')) {
      auftraege.delete(id)
    }
  }
}

/**
 * Nimmt eine abgelegte Datei in die Warteschlange. Die Datei gehört ab hier
 * dem Auftrag und wird nach dem Lesen gelöscht – auch wenn das Lesen scheitert.
 */
export function texterkennungStarten(
  userId: string,
  absolutePath: string,
  mimeType: string,
  log: FastifyBaseLogger,
): Auftrag {
  aufraeumen()

  const auftrag: Auftrag = { id: randomUUID(), userId, status: 'wartet', erstellt: Date.now() }
  auftraege.set(auftrag.id, auftrag)

  kette = kette.then(async () => {
    auftrag.status = 'laeuft'
    const started = Date.now()
    try {
      const result = await extractText(absolutePath, mimeType, await sprachenErmitteln())
      auftrag.text = tidyText(result.text)
      auftrag.status = 'fertig'
      log.info(
        {
          auftrag: auftrag.id,
          method: result.method,
          chars: auftrag.text.length,
          ms: Date.now() - started,
        },
        'Text für eine Notiz erkannt',
      )
    } catch (error) {
      auftrag.status = 'fehler'
      // Bei einer alten Word-Datei sagt die Meldung, warum – und dass die
      // ganze Datei weiterhin geht.
      auftrag.fehler =
        error instanceof KeinTextError
          ? `${error.message} Als ganze Datei lässt sie sich einfügen.`
          : 'Der Text liess sich nicht erkennen.'
      log.warn({ err: error, auftrag: auftrag.id }, 'Texterkennung für eine Notiz fehlgeschlagen')
    } finally {
      await rm(absolutePath, { force: true }).catch(() => undefined)
    }
  })

  return auftrag
}

/** Ein Auftrag – nur für die Person, die ihn gestellt hat. */
export function auftragFuer(id: string, userId: string): Auftrag | undefined {
  const auftrag = auftraege.get(id)
  return auftrag && auftrag.userId === userId ? auftrag : undefined
}
