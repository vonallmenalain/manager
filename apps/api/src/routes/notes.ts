import { randomUUID } from 'node:crypto'

import {
  normalizeForSearch,
  parseChecklist,
  upsertNoteSchema,
  type Note,
  type NoteColor,
  type NoteKind,
} from '@manager/shared'
import { and, desc, eq, like, or, type SQL } from 'drizzle-orm'
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
    kind: row.kind as NoteKind,
    pinned: row.pinned,
    shared: row.shared,
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

/**
 * Wer eine Notiz sehen darf: wer sie angelegt hat, und bei geteilten alle.
 *
 * Steht bewusst in jeder Abfrage, auch beim Ändern und Löschen. Sonst liesse
 * sich eine fremde Notiz über ihre Kennung erreichen, ohne dass sie je in
 * einer Liste aufgetaucht wäre.
 */
function visibleTo(userId: string): SQL {
  const condition = or(eq(notes.createdBy, userId), eq(notes.shared, true))
  if (!condition) throw new Error('Sichtbarkeitsbedingung fehlt')
  return condition
}

/**
 * Der durchsuchbare Text einer Notiz.
 *
 * Bei einer Checkliste ohne die Kästchen: Gesucht wird nach „Milch", nicht
 * nach „[x] Milch", und ein Suchfeld voller eckiger Klammern fände sonst
 * jede Liste.
 */
function searchTextFor(kind: NoteKind, title: string, body: string): string {
  const text =
    kind === 'liste'
      ? parseChecklist(body)
          .map((item) => item.text)
          .join(' ')
      : body
  return normalizeForSearch(`${title} ${text}`)
}

const noteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/notes', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const conditions: SQL[] = [visibleTo(user.id)]
    if (parsed.data.q) {
      // Dieselbe Vereinheitlichung wie bei den Dokumenten – „PRÄMIE" und
      // „praemie" sollen überall dasselbe finden.
      conditions.push(like(notes.searchText, `%${normalizeForSearch(parsed.data.q)}%`))
    }

    const rows = await db
      .select()
      .from(notes)
      .where(and(...conditions))
      // Angeheftete zuerst, darunter die zuletzt bearbeiteten.
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))

    return reply.send({ notes: rows.map(toApi) })
  })

  fastify.post('/api/notes', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = upsertNoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { title, body, kind, pinned, shared, color } = parsed.data
    const inserted = await db
      .insert(notes)
      .values({
        id: randomUUID(),
        title,
        body,
        kind,
        pinned,
        shared,
        color,
        searchText: searchTextFor(kind, title, body),
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

    const { title, body, kind, pinned, shared, color } = parsed.data
    const updated = await db
      .update(notes)
      .set({
        title,
        body,
        kind,
        pinned,
        shared,
        color,
        searchText: searchTextFor(kind, title, body),
        updatedBy: user.id,
        updatedAt: new Date().toISOString(),
      })
      // Die Bedingung prüft den Stand vor der Änderung: Eine fremde private
      // Notiz lässt sich damit nicht durch Mitschicken von shared aufbrechen.
      .where(and(eq(notes.id, id), visibleTo(user.id)))
      .returning()

    const row = updated[0]
    if (!row) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.send({ note: toApi(row) })
  })

  fastify.delete('/api/notes/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const deleted = await db
      .delete(notes)
      .where(and(eq(notes.id, id), visibleTo(user.id)))
      .returning({ id: notes.id })

    if (deleted.length === 0) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.status(204).send()
  })
}

export default noteRoutes
