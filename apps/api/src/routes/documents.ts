import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'

import {
  ALLOWED_MIME_TYPES,
  API_ERROR_CODES,
  buildSearchText,
  DEFAULT_DOCUMENT_STATUS,
  DOCUMENT_STATUSES,
  documentQuerySchema,
  MAX_UPLOAD_BYTES,
  normalizeForSearch,
  OPEN_STATUSES,
  UNASSIGNED,
  UNCATEGORIZED,
  updateDocumentSchema,
  type PreviewInfo,
} from '@manager/shared'
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { ocrWorker } from '../ocr/index.js'
import { categories, documents, type DocumentRow } from '../db/schema.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'
import {
  countPdfPages,
  PREVIEW_MAX_PAGES,
  removePreviews,
  renderPdfPage,
} from '../lib/preview.js'
import {
  describeChanges,
  findAnyDocument,
  findDocument,
  getActivity,
  loadUserNames,
  logActivity,
  toApiDocument,
} from '../lib/documents.js'
import {
  buildStoragePath,
  commitUpload,
  discardUpload,
  extensionFor,
  moveToTrash,
  moveWithinStorage,
  resolveInStorage,
  storeTemporarily,
} from '../lib/storage.js'
import { titleFromFields, titleFromFilename } from '../lib/upload-title.js'

const allowedMimeTypes = new Set<string>(ALLOWED_MIME_TYPES)

/**
 * Trennt eine Mehrfachauswahl in echte Kennungen und das „ohne" darin – etwa
 * `unsortiert` bei den Kategorien. Leere Auswahl heisst „kein Filter" und gibt
 * null zurück, nicht eine Bedingung, die nichts durchlässt.
 */
function auswahl(werte: string[] | undefined, ohneWert: string) {
  if (!werte || werte.length === 0) return null
  return {
    ohne: werte.includes(ohneWert),
    ids: werte.filter((wert) => wert !== ohneWert),
  }
}

/** Verknüpft die Teile eines Filters mit „oder" – fehlende Teile fallen weg. */
function oderNichts(...teile: (SQL | undefined)[]): SQL {
  const vorhanden = teile.filter((teil): teil is SQL => teil !== undefined)
  // Mit einem Teil ist `or` überflüssig, mit keinem gäbe es nichts zu prüfen –
  // dann steht hier eine Bedingung, die nie zutrifft (die Auswahl war leer).
  if (vorhanden.length === 1) return vorhanden[0] as SQL
  return or(...vorhanden) ?? sql`1 = 0`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function categoryNameFor(categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null
  const rows = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1)
  return rows[0]?.name ?? null
}

const documentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  // -------------------------------------------------------------------------
  // Hochladen
  // -------------------------------------------------------------------------
  fastify.post('/api/documents', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const upload = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } })
    if (!upload) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Keine Datei empfangen.'))
    }

    if (!allowedMimeTypes.has(upload.mimetype)) {
      // Den Datenstrom trotzdem leeren, sonst wartet der Client auf ein Ende,
      // das nie kommt.
      upload.file.resume()
      return reply
        .status(415)
        .send(
          apiError(
            'unsupported_type',
            `Dateityp ${upload.mimetype} wird nicht unterstützt. Erlaubt sind PDF und Bilder.`,
          ),
        )
    }

    const documentId = randomUUID()
    const stored = await storeTemporarily(upload.file, documentId)

    // truncated wird erst nach dem Lesen gesetzt – die Prüfung gehört hierhin,
    // nicht davor.
    if (upload.file.truncated) {
      await discardUpload(stored.tempPath)
      return reply
        .status(413)
        .send(
          apiError(
            'file_too_large',
            `Die Datei ist grösser als ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
          ),
        )
    }

    const allowDuplicate = (request.query as { allowDuplicate?: string }).allowDuplicate === '1'
    if (!allowDuplicate) {
      const duplicates = await db
        .select()
        .from(documents)
        .where(and(eq(documents.sha256, stored.sha256), isNull(documents.deletedAt)))
        .limit(1)

      const duplicate = duplicates[0]
      if (duplicate) {
        await discardUpload(stored.tempPath)
        return reply.status(409).send({
          error: {
            code: 'duplicate',
            message: `Diese Datei liegt bereits als „${duplicate.title}" in der Ablage.`,
          },
          existing: toApiDocument(duplicate),
        })
      }
    }

    // Das Feld steht im Formular vor der Datei und ist deshalb hier bereits
    // gelesen – kommt keines, bleibt es beim Dateinamen.
    const title = titleFromFields(upload.fields) ?? titleFromFilename(upload.filename)
    const docDate = today()
    const storagePath = buildStoragePath({
      docDate,
      categoryName: null,
      title,
      documentId,
      extension: extensionFor(upload.mimetype, upload.filename),
    })

    await commitUpload(stored.tempPath, storagePath)

    const inserted = await db
      .insert(documents)
      .values({
        id: documentId,
        title,
        storagePath,
        mimeType: upload.mimetype,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        uploadedBy: user.id,
        docDate,
        status: DEFAULT_DOCUMENT_STATUS,
        searchText: buildSearchText({ title }),
      })
      .returning()

    const row = inserted[0]
    if (!row) throw new Error('Dokument konnte nicht gespeichert werden')

    await logActivity(documentId, user.id, 'upload', `„${title}" hochgeladen`)

    // Sofort wecken statt bis zum nächsten Durchlauf zu warten: Ein Dokument
    // soll durchsuchbar sein, bevor man es überhaupt fertig kategorisiert hat.
    ocrWorker?.notify()

    request.log.info({ documentId, sizeBytes: stored.sizeBytes }, 'Dokument hochgeladen')
    return reply.status(201).send({ document: toApiDocument(row) })
  })

  // -------------------------------------------------------------------------
  // Liste und Suche
  // -------------------------------------------------------------------------
  fastify.get('/api/documents', async (request, reply) => {
    const parsed = documentQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { q, status, categoryId, assignedTo, year, pending, limit, offset } = parsed.data
    const { uploadedFrom, uploadedTo, deleted } = parsed.data

    const conditions: SQL[] = []
    // Standard: ohne Papierkorb. 'nur' ist die Papierkorbansicht, 'mit' zeigt
    // beides – dann trägt jede gelöschte Zeile in der Liste ihren Vermerk.
    if (deleted === 'ohne') conditions.push(isNull(documents.deletedAt))
    if (deleted === 'nur') conditions.push(isNotNull(documents.deletedAt))

    if (q) {
      // Beide Seiten werden gleich vereinheitlicht: die gespeicherte
      // Suchspalte beim Schreiben, die Eingabe hier. Ab Etappe 3 fliesst der
      // OCR-Text in dieselbe Spalte ein.
      conditions.push(like(documents.searchText, `%${normalizeForSearch(q)}%`))
    }

    // Innerhalb eines Filters gilt „oder", zwischen den Filtern „und": Wer
    // zwei Personen anhakt, will beide sehen – wer zusätzlich eine Kategorie
    // wählt, will davon nur diese.
    if (status && status.length > 0) {
      const erlaubt = status.filter((wert): wert is (typeof DOCUMENT_STATUSES)[number] =>
        (DOCUMENT_STATUSES as readonly string[]).includes(wert),
      )
      if (erlaubt.length > 0) conditions.push(inArray(documents.status, erlaubt))
    }
    if (pending) conditions.push(inArray(documents.status, [...OPEN_STATUSES]))

    const kategorien = auswahl(categoryId, UNCATEGORIZED)
    if (kategorien) {
      conditions.push(
        oderNichts(
          kategorien.ohne ? isNull(documents.categoryId) : undefined,
          kategorien.ids.length > 0 ? inArray(documents.categoryId, kategorien.ids) : undefined,
        ),
      )
    }

    const zustaendig = auswahl(assignedTo, UNASSIGNED)
    if (zustaendig) {
      conditions.push(
        oderNichts(
          zustaendig.ohne ? isNull(documents.assignedTo) : undefined,
          zustaendig.ids.length > 0 ? inArray(documents.assignedTo, zustaendig.ids) : undefined,
        ),
      )
    }

    if (year) conditions.push(like(documents.docDate, `${year}-%`))

    // `uploaded_at` ist ein ISO-Zeitstempel; verglichen wird als Text, was bei
    // ISO dasselbe ist wie zeitlich. Der Endtag zählt ganz dazu – wer „bis
    // heute" wählt, meint nicht „bis heute um Mitternacht".
    if (uploadedFrom) conditions.push(gte(documents.uploadedAt, uploadedFrom))
    if (uploadedTo) conditions.push(lte(documents.uploadedAt, `${uploadedTo}T23:59:59.999Z`))

    const where = and(...conditions)

    const rows = await db
      .select()
      .from(documents)
      .where(where)
      // Nach Dokumentdatum sortiert, nicht nach Upload: Wer im Januar die
      // Dezemberrechnung nachträgt, will sie beim Dezember sehen.
      .orderBy(desc(documents.docDate), desc(documents.uploadedAt))
      .limit(limit)
      .offset(offset)

    const counted = await db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(where)

    return reply.send({
      documents: rows.map((row) => toApiDocument(row, q)),
      total: counted[0]?.count ?? 0,
    })
  })

  // -------------------------------------------------------------------------
  // Einzelnes Dokument
  // -------------------------------------------------------------------------
  fastify.get('/api/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    // Auch das Gelöschte: Wer im Papierkorb nachsieht, will es anschauen
    // können – sonst wäre der Papierkorb eine Liste von Titeln.
    const row = await findAnyDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    return reply.send({
      document: {
        ...toApiDocument(row),
        activity: await getActivity(id),
        ocrText: row.ocrText,
        ocrMethod: row.ocrMethod,
        ocrError: row.ocrError,
      },
    })
  })

  // -------------------------------------------------------------------------
  // Datei ausliefern
  // -------------------------------------------------------------------------
  fastify.get('/api/documents/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }

    const row = await findAnyDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    const absolute = resolveInStorage(row.storagePath)
    const extension = row.storagePath.split('.').pop() ?? 'bin'
    // Der Dateiname für den Nutzer wird aus dem Titel gebildet, nicht aus dem
    // Ablagepfad – der enthält die technische Kurz-ID.
    const filename = `${row.title.replace(/["\\]/g, '')}.${extension}`

    reply.header(
      'content-disposition',
      `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    reply.header('cache-control', 'private, max-age=300')
    // Helmet setzt global 'same-site'. Das blockiert die Bildvorschau, sobald
    // Frontend und API auf getrennten Adressen liegen – also immer.
    // Unbedenklich, weil hier nicht diese Kopfzeile die Grenze zieht, sondern
    // die Anmeldung: Das Sitzungs-Cookie ist SameSite=Lax und wird bei einer
    // Einbettung von fremder Seite gar nicht erst mitgeschickt. Eine solche
    // Anfrage landet bei 401, nicht beim Dokument.
    reply.header('cross-origin-resource-policy', 'cross-origin')
    return reply.type(row.mimeType).send(createReadStream(absolute))
  })

  // -------------------------------------------------------------------------
  // Vorschau
  //
  // Zwei Endpunkte statt einem: Der erste sagt, ob und wie viel es zu sehen
  // gibt, der zweite liefert die einzelne Seite. So weiss das Frontend vor dem
  // ersten Bild, ob es überhaupt blättern lassen muss.
  // -------------------------------------------------------------------------
  fastify.get('/api/documents/:id/preview', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await findAnyDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    if (row.mimeType.startsWith('image/')) {
      return reply.send({ kind: 'image', pages: 1 } satisfies PreviewInfo)
    }

    if (row.mimeType === 'application/pdf') {
      const pages = await countPdfPages(resolveInStorage(row.storagePath))
      if (pages === 0) return reply.send({ kind: 'none', pages: 0 } satisfies PreviewInfo)
      return reply.send({
        kind: 'pdf',
        pages: Math.min(pages, PREVIEW_MAX_PAGES),
      } satisfies PreviewInfo)
    }

    return reply.send({ kind: 'none', pages: 0 } satisfies PreviewInfo)
  })

  fastify.get('/api/documents/:id/preview/:page', async (request, reply) => {
    const { id, page } = request.params as { id: string; page: string }

    // Die Seitennummer landet im Dateinamen des Zwischenspeichers – sie muss
    // eine Zahl sein, bevor sie irgendwo hinkommt.
    const pageNumber = Number(page)
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > PREVIEW_MAX_PAGES) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Ungültige Seitennummer.'))
    }

    const row = await findAnyDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))
    if (row.mimeType !== 'application/pdf') {
      return reply.status(404).send(notFound('Für diese Datei gibt es keine Seitenvorschau.'))
    }

    let imagePath: string
    try {
      imagePath = await renderPdfPage(id, resolveInStorage(row.storagePath), pageNumber)
    } catch (error) {
      request.log.warn({ err: error, documentId: id, page: pageNumber }, 'Vorschau fehlgeschlagen')
      return reply
        .status(422)
        .send(apiError('preview_failed', 'Diese Seite liess sich nicht darstellen.'))
    }

    // Ein gerastertes Bild ändert sich nie – der Browser darf es behalten.
    reply.header('cache-control', 'private, max-age=86400')
    reply.header('cross-origin-resource-policy', 'cross-origin')
    return reply.type('image/jpeg').send(createReadStream(imagePath))
  })

  // -------------------------------------------------------------------------
  // Ändern
  // -------------------------------------------------------------------------
  fastify.patch('/api/documents/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const before = await findDocument(id)
    if (!before) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    const parsed = updateDocumentSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const changes = parsed.data
    if (Object.keys(changes).length === 0) {
      return reply.send({ document: { ...toApiDocument(before), activity: await getActivity(id) } })
    }

    const merged: DocumentRow = { ...before, ...changes } as DocumentRow

    // Titel, Kategorie oder Datum bestimmen den Ablagepfad. Ändert sich einer
    // davon, wandert die Datei mit – sonst driftet die Ordnerstruktur mit der
    // Zeit von den Metadaten weg und der Vorteil lesbarer Pfade ist dahin.
    let storagePath = before.storagePath
    const affectsPath =
      changes.title !== undefined ||
      changes.categoryId !== undefined ||
      changes.docDate !== undefined

    if (affectsPath) {
      const extension = before.storagePath.split('.').pop() ?? 'bin'
      const nextPath = buildStoragePath({
        docDate: merged.docDate,
        categoryName: await categoryNameFor(merged.categoryId),
        title: merged.title,
        documentId: before.id,
        extension,
      })

      try {
        if (await moveWithinStorage(before.storagePath, nextPath)) {
          storagePath = nextPath
        }
      } catch (error) {
        // Metadaten trotzdem speichern: Ein fehlgeschlagenes Umbenennen darf
        // die Bearbeitung nicht blockieren – der Pfad bleibt dann einfach alt.
        request.log.error({ err: error, documentId: id }, 'Datei konnte nicht verschoben werden')
      }
    }

    const updated = await db
      .update(documents)
      .set({
        ...changes,
        storagePath,
        // merged enthält den erkannten Text – ohne ihn wäre er nach
        // jeder Bearbeitung aus der Suche verschwunden.
        searchText: buildSearchText(merged),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documents.id, id))
      .returning()

    const row = updated[0]
    if (!row) throw new Error('Dokument konnte nicht aktualisiert werden')

    const names = await loadUserNames()
    for (const entry of describeChanges(before, changes as Partial<DocumentRow>, names)) {
      await logActivity(id, user.id, entry.action, entry.summary)
    }

    return reply.send({
      document: {
        ...toApiDocument(row),
        activity: await getActivity(id),
        ocrText: row.ocrText,
        ocrMethod: row.ocrMethod,
        ocrError: row.ocrError,
      },
    })
  })

  // -------------------------------------------------------------------------
  // Texterkennung erneut anstossen
  // -------------------------------------------------------------------------
  fastify.post('/api/documents/:id/ocr', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await findDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    // Zähler zurücksetzen: Ein neuer Anlauf von Hand soll wieder die vollen
    // drei Versuche bekommen, sonst bringt der Knopf nach einem Fehlschlag nichts.
    await db
      .update(documents)
      .set({ ocrStatus: 'pending', ocrAttempts: 0, ocrError: null })
      .where(eq(documents.id, id))

    ocrWorker?.notify()
    return reply.status(202).send({ ocrStatus: 'pending' })
  })

  // -------------------------------------------------------------------------
  // Löschen (in den Papierkorb)
  // -------------------------------------------------------------------------
  fastify.delete('/api/documents/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const row = await findDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))

    let storagePath = row.storagePath
    try {
      storagePath = await moveToTrash(row.storagePath)
    } catch (error) {
      request.log.error({ err: error, documentId: id }, 'Verschieben in den Papierkorb fehlgeschlagen')
    }

    // Die gerasterten Seiten wandern nicht mit: Sie sind jederzeit neu
    // erzeugbar und hätten im Papierkorb nur Platz belegt.
    await removePreviews(id).catch((error: unknown) => {
      request.log.warn({ err: error, documentId: id }, 'Vorschau-Bilder nicht entfernt')
    })

    await db
      .update(documents)
      .set({ deletedAt: new Date().toISOString(), storagePath })
      .where(eq(documents.id, id))

    await logActivity(id, user.id, 'delete', `„${row.title}" in den Papierkorb gelegt`)

    return reply.status(204).send()
  })

  /**
   * Aus dem Papierkorb zurückholen.
   *
   * Ein Papierkorb, aus dem man nichts herausnehmen kann, ist keiner. Die
   * Datei liegt unter `.trash/…` und wandert an ihren alten Platz zurück; die
   * Vorschau-Bilder wurden beim Löschen entfernt und entstehen beim nächsten
   * Ansehen von selbst neu.
   */
  fastify.post('/api/documents/:id/wiederherstellen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const row = await findAnyDocument(id)
    if (!row) return reply.status(404).send(notFound('Dokument nicht gefunden.'))
    if (!row.deletedAt) {
      return reply
        .status(409)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Dieses Dokument liegt nicht im Papierkorb.'))
    }

    let storagePath = row.storagePath
    const zurueck = storagePath.replace(/^\.trash[/\\]/, '')
    try {
      await moveWithinStorage(storagePath, zurueck)
      storagePath = zurueck
    } catch (error) {
      // Die Datei bleibt notfalls im Papierkorb-Ordner liegen; der Eintrag ist
      // wieder da und zeigt weiterhin auf sie. Besser ein Dokument an der
      // falschen Stelle als eines, das man nicht zurückholen kann.
      request.log.error({ err: error, documentId: id }, 'Zurückholen aus dem Papierkorb misslungen')
    }

    await db
      .update(documents)
      .set({ deletedAt: null, storagePath })
      .where(eq(documents.id, id))

    await logActivity(id, user.id, 'restore', `„${row.title}" aus dem Papierkorb geholt`)

    const wieder = await findDocument(id)
    return reply.send({ document: wieder ? toApiDocument(wieder) : null })
  })
}

export default documentRoutes
