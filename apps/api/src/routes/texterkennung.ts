import { randomUUID } from 'node:crypto'

import {
  API_ERROR_CODES,
  isAllowedMimeType,
  MAX_UPLOAD_BYTES,
  uploadMimeType,
  type TexterkennungAuftrag,
} from '@manager/shared'
import type { FastifyPluginAsync } from 'fastify'

import { apiError, notFound, unauthorized } from '../lib/errors.js'
import { discardUpload, storeTemporarily } from '../lib/storage.js'
import { auftragFuer, texterkennungStarten } from '../ocr/auftraege.js'

/**
 * „Text erkennen und einfügen": Datei hochladen, Kennung zurück, nachfragen,
 * bis der Text da ist (siehe ocr/auftraege.ts).
 */
const texterkennungRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.post('/api/texterkennung', async (request, reply) => {
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
            `Aus ${mimeType || 'dieser Datei'} lässt sich kein Text lesen. Möglich sind PDF und Bilder.`,
          ),
        )
    }

    // Im Zwischenordner der Haushalts-Ablage: Die Datei bleibt nur, bis sie
    // gelesen ist, und das stündliche Aufräumen erwischt alles, was ein
    // Neustart dort liegen lässt.
    const stored = await storeTemporarily('manager', upload.file, `lesen-${randomUUID()}`)
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

    const auftrag = texterkennungStarten(user.id, stored.tempPath, mimeType, request.log)
    return reply
      .status(202)
      .send({ id: auftrag.id, status: auftrag.status } satisfies TexterkennungAuftrag)
  })

  fastify.get('/api/texterkennung/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())
    const { id } = request.params as { id: string }

    const auftrag = auftragFuer(id, user.id)
    if (!auftrag) {
      // Unbekannt oder abgelaufen – auch nach einem Neustart des Servers.
      return reply.status(404).send(notFound('Dieser Auftrag ist nicht mehr bekannt.'))
    }

    return reply.send({
      id: auftrag.id,
      status: auftrag.status,
      ...(auftrag.status === 'fertig' ? { text: auftrag.text ?? '' } : {}),
      ...(auftrag.status === 'fehler' ? { message: auftrag.fehler } : {}),
    } satisfies TexterkennungAuftrag)
  })
}

export default texterkennungRoutes
