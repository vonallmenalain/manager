import { randomUUID } from 'node:crypto'

import {
  API_ERROR_CODES,
  bereichSchema,
  createCategorySchema,
  DEFAULT_BEREICH,
  updateCategorySchema,
} from '@manager/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { categories, documents } from '../db/schema.js'
import {
  DEFAULT_SORT_ORDER,
  documentsOfCategory,
  findCategory,
  findCategoryByName,
  relocateDocuments,
} from '../lib/categories.js'
import { logActivity } from '../lib/documents.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'

/**
 * Die Kategorien der Ablage.
 *
 * Anlegen darf jeder: Wer gerade Post in der Hand hat und merkt, dass die
 * passende Schublade fehlt, soll sie im selben Griff aufmachen können – sonst
 * landet das Dokument unsortiert und bleibt dort. Umbenennen und Löschen sind
 * dem Verwalter vorbehalten: Beides greift in die Ordnerstruktur auf dem NAS
 * ein und betrifft die Dokumente der anderen Person mit.
 */
const categoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/categories', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    // Ohne Angabe der Haushalt: Eine Abfrage, die den Bereich vergisst, soll
    // nichts aus der DocBase zeigen – nicht alles aus beiden.
    const bereich = bereichSchema
      .catch(DEFAULT_BEREICH)
      .parse((request.query as { bereich?: string }).bereich)

    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(eq(categories.bereich, bereich))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    return reply.send({ categories: rows })
  })

  fastify.post('/api/categories', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { name, bereich } = parsed.data
    const existing = await findCategoryByName(bereich, name)
    if (existing) {
      // Kein Fehler im engeren Sinn, aber auch kein Erfolg: Wer „Kinder"
      // anlegen will und „Kinder" schon hat, soll den Namen sehen, den es
      // bereits gibt – gerade wenn er sich nur in der Schreibweise unterscheidet.
      return reply.status(409).send(
        apiError(API_ERROR_CODES.validationFailed, 'Diese Kategorie gibt es bereits.', {
          name: `„${existing.name}" gibt es bereits.`,
        }),
      )
    }

    const category = {
      id: randomUUID(),
      name,
      icon: 'folder',
      sortOrder: DEFAULT_SORT_ORDER,
      bereich,
    }
    await db.insert(categories).values(category)

    request.log.info(
      { categoryId: category.id, bereich, by: request.user?.id },
      'Kategorie angelegt',
    )
    return reply.status(201).send({ category })
  })

  /**
   * Umbenennen. Die Dateien wandern in den Ordner des neuen Namens mit –
   * sonst hiesse die Kategorie in der App anders als in der Freigabe, und
   * genau das soll die lesbare Ordnerstruktur verhindern.
   */
  fastify.patch(
    '/api/categories/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const before = await findCategory(id)
      if (!before) return reply.status(404).send(notFound('Kategorie nicht gefunden.'))

      const parsed = updateCategorySchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

      const { name } = parsed.data
      const clash = await findCategoryByName(before.bereich, name, id)
      if (clash) {
        return reply.status(409).send(
          apiError(API_ERROR_CODES.validationFailed, 'Diese Kategorie gibt es bereits.', {
            name: `„${clash.name}" gibt es bereits.`,
          }),
        )
      }

      await db.update(categories).set({ name }).where(eq(categories.id, id))
      await relocateDocuments(await documentsOfCategory(id), name)

      request.log.info({ categoryId: id, from: before.name, to: name }, 'Kategorie umbenannt')
      return reply.send({ category: { ...before, name } })
    },
  )

  /**
   * Löschen. Die Dokumente gehen dabei nicht verloren: Sie werden unsortiert
   * und ihre Dateien wandern in den Ordner „Unsortiert" nach – derselbe
   * Zustand wie frisch hochgeladen.
   */
  fastify.delete(
    '/api/categories/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request, reply) => {
      const user = request.user
      if (!user) return reply.status(401).send(unauthorized())

      const { id } = request.params as { id: string }
      const category = await findCategory(id)
      if (!category) return reply.status(404).send(notFound('Kategorie nicht gefunden.'))

      // Erst die betroffenen Dokumente merken, dann die Zuordnung lösen: Nach
      // dem Löschen der Kategorie wäre nicht mehr zu ermitteln, welche es waren.
      const affected = await documentsOfCategory(id)
      await db
        .update(documents)
        .set({ categoryId: null })
        .where(and(eq(documents.categoryId, id), eq(documents.bereich, category.bereich)))
      await db.delete(categories).where(eq(categories.id, id))

      await relocateDocuments(affected, null)

      // Der Verlauf eines Dokuments soll erklären, warum es plötzlich
      // unsortiert dasteht – sonst sieht es nach einem Versehen aus.
      for (const document of affected) {
        await logActivity(
          document.id,
          user.id,
          'edit',
          `Kategorie „${category.name}" gelöscht – Dokument ist jetzt unsortiert`,
        )
      }

      request.log.info(
        { categoryId: id, name: category.name, unsorted: affected.length },
        'Kategorie gelöscht',
      )
      return reply.send({ unsorted: affected.length })
    },
  )
}

export default categoryRoutes
