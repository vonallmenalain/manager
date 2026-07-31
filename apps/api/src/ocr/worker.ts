import { writeFile } from 'node:fs/promises'

import { buildSearchText, type Bereich } from '@manager/shared'
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'

import { db } from '../db/index.js'
import { documents, type DocumentRow } from '../db/schema.js'
import { env } from '../env.js'
import { resolveInStorage } from '../lib/storage.js'
import { extractText, resolveLanguages, tidyText } from './extract.js'

/** Nach drei erfolglosen Anläufen bringt ein vierter erfahrungsgemäss nichts. */
const MAX_ATTEMPTS = 3

/**
 * Wie lange gewartet wird, wenn nichts zu tun ist. Kurz genug, dass ein
 * Dokument kurz nach dem Upload erkannt ist, lang genug, dass ein NAS im
 * Leerlauf nichts davon merkt. Ein Upload weckt den Worker ohnehin sofort.
 */
const IDLE_INTERVAL_MS = 15_000

export class OcrWorker {
  #log: FastifyBaseLogger
  #languages: string | null = null
  #running = false
  #stopped = false
  #timer: NodeJS.Timeout | null = null
  #wakeUp: (() => void) | null = null

  constructor(log: FastifyBaseLogger) {
    this.#log = log.child({ component: 'ocr' })
  }

  async start(): Promise<void> {
    try {
      this.#languages = await resolveLanguages(env.OCR_LANGUAGES)
      this.#log.info({ languages: this.#languages }, 'Texterkennung bereit')
    } catch (error) {
      // Ohne Tesseract läuft die App weiter – nur eben ohne Texterkennung.
      // Das ist deutlich besser, als den Start zu verweigern.
      this.#log.error(
        { err: error },
        'Texterkennung nicht verfügbar, Dokumente bleiben ohne erkannten Text',
      )
      return
    }

    void this.#loop()
  }

  /** Nach einem Upload aufrufen, damit nicht bis zum nächsten Durchlauf gewartet wird. */
  notify(): void {
    this.#wakeUp?.()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#wakeUp?.()
  }

  async #loop(): Promise<void> {
    while (!this.#stopped) {
      let didWork = false
      try {
        didWork = await this.#processNext()
      } catch (error) {
        this.#log.error({ err: error }, 'Unerwarteter Fehler im Durchlauf')
      }

      // Solange etwas zu tun war, direkt weitermachen; erst danach schlafen.
      if (!didWork) await this.#sleep()
    }
  }

  #sleep(): Promise<void> {
    return new Promise((resolve) => {
      this.#wakeUp = () => {
        this.#wakeUp = null
        if (this.#timer) clearTimeout(this.#timer)
        resolve()
      }
      this.#timer = setTimeout(() => {
        this.#wakeUp = null
        resolve()
      }, IDLE_INTERVAL_MS)
      this.#timer.unref()
    })
  }

  async #claimNext(): Promise<DocumentRow | undefined> {
    const candidates = await db
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          or(
            eq(documents.ocrStatus, 'pending'),
            // Ein Lauf, der beim Herunterfahren mitten drin war, steht sonst
            // für immer auf 'running'.
            and(eq(documents.ocrStatus, 'running'), lt(documents.ocrAttempts, MAX_ATTEMPTS)),
          ),
        ),
      )
      .orderBy(asc(documents.uploadedAt))
      .limit(1)

    const candidate = candidates[0]
    if (!candidate) return undefined

    await db
      .update(documents)
      .set({ ocrStatus: 'running', ocrAttempts: candidate.ocrAttempts + 1 })
      .where(eq(documents.id, candidate.id))

    return candidate
  }

  async #processNext(): Promise<boolean> {
    if (this.#running || !this.#languages) return false
    this.#running = true

    try {
      const document = await this.#claimNext()
      if (!document) return false

      const started = Date.now()
      try {
        const result = await extractText(
          resolveInStorage(document.bereich as Bereich, document.storagePath),
          document.mimeType,
          this.#languages,
        )
        const text = tidyText(result.text)

        // Der erkannte Text landet zusätzlich als .txt neben dem Original.
        // Damit ist er auch dann noch lesbar und durchsuchbar, wenn man die
        // Ablage direkt über die Dateifreigabe durchsieht.
        const sidecar = document.storagePath.replace(/\.[^./\\]+$/, '.txt')
        try {
          await writeFile(
            resolveInStorage(document.bereich as Bereich, sidecar),
            text,
            'utf8',
          )
        } catch (error) {
          this.#log.warn({ err: error, documentId: document.id }, 'Textdatei nicht geschrieben')
        }

        await db
          .update(documents)
          .set({
            ocrStatus: 'done',
            ocrText: text,
            ocrMethod: result.method,
            ocrError: null,
            ocrFinishedAt: new Date().toISOString(),
            // Der erkannte Text fliesst in dieselbe Suchspalte wie die
            // Metadaten – die Suche muss dadurch nichts anders machen.
            searchText: buildSearchText({
              title: document.title,
              vendor: document.vendor,
              notes: document.notes,
              ocrText: text,
            }),
          })
          .where(eq(documents.id, document.id))

        this.#log.info(
          {
            documentId: document.id,
            method: result.method,
            pages: result.pages,
            chars: text.length,
            ms: Date.now() - started,
          },
          'Text erkannt',
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const attempts = document.ocrAttempts + 1
        const exhausted = attempts >= MAX_ATTEMPTS

        await db
          .update(documents)
          .set({
            // Nicht erschöpft: zurück in die Warteschlange für den nächsten Durchlauf.
            ocrStatus: exhausted ? 'failed' : 'pending',
            ocrError: message.slice(0, 500),
            ocrFinishedAt: exhausted ? new Date().toISOString() : null,
          })
          .where(eq(documents.id, document.id))

        this.#log[exhausted ? 'error' : 'warn'](
          { documentId: document.id, attempts, err: error },
          exhausted ? 'Texterkennung endgültig fehlgeschlagen' : 'Texterkennung fehlgeschlagen',
        )
      }

      return true
    } finally {
      this.#running = false
    }
  }
}
