import { randomUUID } from 'node:crypto'

import {
  normalizeForSearch,
  upsertNoteSchema,
  type Note,
  type NoteColor,
} from '@manager/shared'
import { and, desc, eq, like, type SQL } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import { notes, type NoteRow } from '../db/schema.js'
import { notFound, unauthorized, validationError } from '../lib/errors.js'

function toApi(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    color: row.color as NoteColor,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
})

const noteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/notes', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const conditions: SQL[] = []
    if (parsed.data.q) {
      // Dieselbe Vereinheitlichung wie bei den Dokumenten – „PRÄMIE" und
      // „praemie" sollen überall dasselbe finden.
      conditions.push(like(notes.searchText, `%${normalizeForSearch(parsed.data.q)}%`))
    }

    const rows = await db
      .select()
      .from(notes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      // Angeheftete zuerst, darunter die zuletzt bearbeiteten.
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))

    return reply.send({ notes: rows.map(toApi) })
  })

  fastify.post('/api/notes', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = upsertNoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { title, body, pinned, color } = parsed.data
    const inserted = await db
      .insert(notes)
      .values({
        id: randomUUID(),
        title,
        body,
        pinned,
        color,
        searchText: normalizeForSearch(`${title} ${body}`),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning()

    const row = inserted[0]
    if (!row) throw new Error('Notiz konnte nicht gespeichert werden')
    return reply.status(201).send({ note: toApi(row) })
  })

  fastify.patch('/api/notes/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const parsed = upsertNoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { title, body, pinned, color } = parsed.data
    const updated = await db
      .update(notes)
      .set({
        title,
        body,
        pinned,
        color,
        searchText: normalizeForSearch(`${title} ${body}`),
        updatedBy: user.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(notes.id, id))
      .returning()

    const row = updated[0]
    if (!row) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.send({ note: toApi(row) })
  })

  fastify.delete('/api/notes/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const deleted = await db.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id })

    if (deleted.length === 0) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.status(204).send()
  })
}

export default noteRoutes
