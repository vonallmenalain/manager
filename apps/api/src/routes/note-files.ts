import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'

import {
  ALLOWED_FILES_LABEL,
  API_ERROR_CODES,
  cleanFileName,
  isAllowedMimeType,
  MAX_UPLOAD_BYTES,
  uploadMimeType,
  type Bereich,
  type PreviewInfo,
  type RichFile,
} from '@manager/shared'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { noteFiles } from '../db/schema.js'
import { apiError, notFound, unauthorized } from '../lib/errors.js'
import { findVisibleNoteFile } from '../lib/note-files.js'
import {
  countPdfPages,
  PREVIEW_MAX_PAGES,
  renderPdfPage,
  renderPdfThumbnail,
} from '../lib/preview.js'
import {
  commitUpload,
  discardUpload,
  extensionFor,
  resolveInStorage,
  storeTemporarily,
} from '../lib/storage.js'
import { buildNoteFilePath } from '../lib/storage-paths.js'
import { metadataFromFields } from '../lib/upload-fields.js'

/**
 * Dateien in Notizen: hochladen, anzeigen, öffnen.
 *
 * Dieselben Wege wie bei den Dokumenten – Datei, Vorschau, gerasterte Seite,
 * Vorschaubild –, nur ohne alles, was zur Ablage gehört: kein Titel, keine
 * Kategorie, keine Texterkennung im Hintergrund. Eine Beilage wird gezeigt und
 * geöffnet, nicht verwaltet.
 */
const noteFileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.post('/api/notes/files', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const upload = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } })
    if (!upload) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Keine Datei empfangen.'))
    }

    const mimeType = uploadMimeType(upload.mimetype, upload.filename)
    if (!isAllowedMimeType(mimeType)) {
      upload.file.resume()
      return reply
        .status(415)
        .send(
          apiError(
            'unsupported_type',
            `Dateityp ${mimeType || 'unbekannt'} wird nicht unterstützt. Erlaubt sind ${ALLOWED_FILES_LABEL}.`,
          ),
        )
    }

    // Der Bereich steht im Formular vor der Datei – wie beim Dokument
    // entscheidet er, in welcher Ablage schon der Zwischenspeicher liegt.
    const bereich = metadataFromFields(upload.fields).bereich
    const fileId = randomUUID()
    const stored = await storeTemporarily(bereich, upload.file, fileId)

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

    const name = cleanFileName(upload.filename || 'Datei')
    const storagePath = buildNoteFilePath({
      date: new Date().toISOString().slice(0, 10),
      name,
      fileId,
      extension: extensionFor(mimeType, upload.filename),
    })

    try {
      await commitUpload(bereich, stored.tempPath, storagePath)
    } catch (error) {
      await discardUpload(stored.tempPath)
      request.log.error({ err: error }, 'Notiz-Datei konnte nicht abgelegt werden')
      return reply
        .status(500)
        .send(apiError('storage_failed', 'Die Datei liess sich nicht speichern.'))
    }

    await db.insert(noteFiles).values({
      id: fileId,
      bereich,
      filename: name,
      mimeType,
      sizeBytes: stored.sizeBytes,
      storagePath,
      createdBy: user.id,
    })

    const file: RichFile = { id: fileId, name, mime: mimeType, size: stored.sizeBytes }
    return reply.status(201).send({ file })
  })

  fastify.get('/api/notes/files/:id/datei', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }

    const row = await findVisibleNoteFile(id, user.id)
    if (!row) return reply.status(404).send(notFound('Datei nicht gefunden.'))

    reply.header(
      'content-disposition',
      `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    )
    reply.header('cache-control', 'private, max-age=300')
    // Wie bei den Dokumenten: Die Grenze zieht die Anmeldung, nicht diese
    // Kopfzeile – ohne sie blockierte Helmet die Anzeige in der App.
    reply.header('cross-origin-resource-policy', 'cross-origin')
    return reply
      .type(row.mimeType)
      .send(createReadStream(resolveInStorage(row.bereich as Bereich, row.storagePath)))
  })

  fastify.get('/api/notes/files/:id/vorschau', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())
    const { id } = request.params as { id: string }

    const row = await findVisibleNoteFile(id, user.id)
    if (!row) return reply.status(404).send(notFound('Datei nicht gefunden.'))

    if (row.mimeType.startsWith('image/')) {
      return reply.send({ kind: 'image', pages: 1, totalPages: 1 } satisfies PreviewInfo)
    }
    // Word, Excel & Co. zeigt der Betrachter nicht – er bietet sie zum Öffnen an.
    if (row.mimeType !== 'application/pdf') {
      return reply.send({ kind: 'none', pages: 0, totalPages: 0 } satisfies PreviewInfo)
    }

    const pages = await countPdfPages(resolveInStorage(row.bereich as Bereich, row.storagePath))
    if (pages === 0) {
      return reply.send({ kind: 'none', pages: 0, totalPages: 0 } satisfies PreviewInfo)
    }
    return reply.send({
      kind: 'pdf',
      pages: Math.min(pages, PREVIEW_MAX_PAGES),
      totalPages: pages,
    } satisfies PreviewInfo)
  })

  fastify.get('/api/notes/files/:id/vorschau/:page', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())
    const { id, page } = request.params as { id: string; page: string }

    const pageNumber = Number(page)
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > PREVIEW_MAX_PAGES) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Ungültige Seitennummer.'))
    }

    const row = await findVisibleNoteFile(id, user.id)
    if (!row) return reply.status(404).send(notFound('Datei nicht gefunden.'))
    if (row.mimeType !== 'application/pdf') {
      return reply.status(404).send(notFound('Für diese Datei gibt es keine Seitenvorschau.'))
    }

    let imagePath: string
    try {
      imagePath = await renderPdfPage(
        row.bereich as Bereich,
        id,
        resolveInStorage(row.bereich as Bereich, row.storagePath),
        pageNumber,
      )
    } catch (error) {
      request.log.warn({ err: error, fileId: id, page: pageNumber }, 'Vorschau fehlgeschlagen')
      return reply
        .status(422)
        .send(apiError('preview_failed', 'Diese Seite liess sich nicht darstellen.'))
    }

    reply.header('cache-control', 'private, max-age=86400')
    reply.header('cross-origin-resource-policy', 'cross-origin')
    return reply.type('image/jpeg').send(createReadStream(imagePath))
  })

  /**
   * Das kleine Bild, das in der Notiz steht: bei einem Foto die Datei selbst,
   * bei einem PDF die erste Seite, klein gerechnet.
   */
  fastify.get('/api/notes/files/:id/vorschaubild', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())
    const { id } = request.params as { id: string }

    const row = await findVisibleNoteFile(id, user.id)
    if (!row) return reply.status(404).send(notFound('Datei nicht gefunden.'))

    reply.header('cross-origin-resource-policy', 'cross-origin')
    const bereich = row.bereich as Bereich

    if (row.mimeType.startsWith('image/')) {
      reply.header('cache-control', 'private, max-age=300')
      return reply
        .type(row.mimeType)
        .send(createReadStream(resolveInStorage(bereich, row.storagePath)))
    }
    if (row.mimeType !== 'application/pdf') {
      return reply.status(404).send(notFound('Für diese Datei gibt es kein Vorschaubild.'))
    }

    let imagePath: string
    try {
      imagePath = await renderPdfThumbnail(bereich, id, resolveInStorage(bereich, row.storagePath))
    } catch (error) {
      request.log.warn({ err: error, fileId: id }, 'Vorschaubild fehlgeschlagen')
      return reply
        .status(422)
        .send(apiError('preview_failed', 'Für diese Datei gibt es kein Vorschaubild.'))
    }

    reply.header('cache-control', 'private, max-age=86400')
    return reply.type('image/jpeg').send(createReadStream(imagePath))
  })
}

export default noteFileRoutes
