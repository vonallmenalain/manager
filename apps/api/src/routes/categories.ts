import { randomUUID } from 'node:crypto'

import {
  API_ERROR_CODES,
  bereichSchema,
  createCategorySchema,
  DEFAULT_BEREICH,
  updateCategorySchema,
} from '@manager/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { categories, documents } from '../db/schema.js'
import {
  childCategories,
  DEFAULT_SORT_ORDER,
  documentsOfCategories,
  findCategory,
  findCategoryByName,
  relocateDocuments,
} from '../lib/categories.js'
import { logActivity } from '../lib/documents.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'

/**
 * Die Kategorien der Ablage – in zwei Ebenen.
 *
 * Anlegen darf jeder: Wer gerade Post in der Hand hat und merkt, dass die
 * passende Schublade fehlt, soll sie im selben Griff aufmachen können – sonst
 * landet das Dokument unsortiert und bleibt dort. Umbenennen und Löschen sind
 * dem Verwalter vorbehalten: Beides greift in die Ordnerstruktur auf dem NAS
 * ein und betrifft die Dokumente der anderen Person mit.
 *
 * Eine Unterkategorie ist keine eigene Art von Zeile, sondern eine gewöhnliche
 * Kategorie mit `parentId`. Dokumente hängen deshalb an Haupt- wie
 * Unterkategorien gleichermassen – „gehört zu Notfall, aber in keine der
 * Unterschubladen" ist ein Zustand, den es geben muss.
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
        parentId: categories.parentId,
      })
      .from(categories)
      .where(eq(categories.bereich, bereich))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    // Flach ausgeliefert und nicht verschachtelt: Die Liste ist an einem
    // Dutzend Stellen im Zwischenspeicher, und eine flache Liste lässt sich
    // dort nach einer Kennung durchsuchen, ohne sie erst aufzuklappen. Die
    // beiden Ebenen baut das Frontend daraus mit groupCategories.
    return reply.send({ categories: rows })
  })

  fastify.post('/api/categories', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { name, bereich } = parsed.data
    const parentId = parsed.data.parentId ?? null

    if (parentId) {
      const parent = await findCategory(parentId)
      if (!parent || parent.bereich !== bereich) {
        return reply.status(400).send(
          apiError(API_ERROR_CODES.validationFailed, 'Die Hauptkategorie gibt es nicht.', {
            parentId: 'Diese Hauptkategorie gibt es nicht.',
          }),
        )
      }
      // Zwei Ebenen, nicht drei: Eine dritte beantwortet keine Frage mehr, die
      // sich beim Ablegen stellt, macht aber jede Auswahl unübersichtlich.
      if (parent.parentId) {
        return reply.status(400).send(
          apiError(
            API_ERROR_CODES.validationFailed,
            'Eine Unterkategorie kann keine weiteren Unterkategorien haben.',
            { parentId: `„${parent.name}" ist bereits eine Unterkategorie.` },
          ),
        )
      }
    }

    const existing = await findCategoryByName(bereich, name, parentId)
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
      parentId,
    }
    await db.insert(categories).values(category)

    request.log.info(
      { categoryId: category.id, bereich, parentId, by: request.user?.id },
      'Kategorie angelegt',
    )
    return reply.status(201).send({ category })
  })

  /**
   * Umbenennen. Die Dateien wandern in den Ordner des neuen Namens mit –
   * sonst hiesse die Kategorie in der App anders als in der Freigabe, und
   * genau das soll die lesbare Ordnerstruktur verhindern.
   *
   * Bei einer Hauptkategorie ziehen auch die Dokumente ihrer Unterkategorien
   * um: Deren Pfad beginnt mit dem Namen, der sich gerade geändert hat.
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
      const clash = await findCategoryByName(before.bereich, name, before.parentId, id)
      if (clash) {
        return reply.status(409).send(
          apiError(API_ERROR_CODES.validationFailed, 'Diese Kategorie gibt es bereits.', {
            name: `„${clash.name}" gibt es bereits.`,
          }),
        )
      }

      const betroffen = [id, ...(await childCategories(id)).map((child) => child.id)]

      await db.update(categories).set({ name }).where(eq(categories.id, id))
      // Erst umbenennen, dann verschieben: relocateDocuments liest den neuen
      // Namen aus der Datenbank.
      await relocateDocuments(await documentsOfCategories(betroffen))

      request.log.info({ categoryId: id, from: before.name, to: name }, 'Kategorie umbenannt')
      return reply.send({ category: { ...before, name } })
    },
  )

  /**
   * Löschen. Die Dokumente gehen dabei nicht verloren: Sie werden unsortiert
   * und ihre Dateien wandern in den Ordner „Unsortiert" nach – derselbe
   * Zustand wie frisch hochgeladen.
   *
   * Eine Hauptkategorie nimmt ihre Unterkategorien mit. Alles andere wäre eine
   * Frage, die man beim Löschen nicht beantworten will: Unterkategorien ohne
   * Hauptkategorie stünden danach als Hauptkategorien in der Liste, und
   * niemand hätte darum gebeten.
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

      const children = await childCategories(id)
      const betroffen = [id, ...children.map((child) => child.id)]

      // Erst die betroffenen Dokumente merken, dann die Zuordnung lösen: Nach
      // dem Löschen der Kategorie wäre nicht mehr zu ermitteln, welche es waren.
      const affected = await documentsOfCategories(betroffen)
      await db
        .update(documents)
        .set({ categoryId: null })
        .where(
          and(
            inArray(documents.categoryId, betroffen),
            eq(documents.bereich, category.bereich),
          ),
        )
      // Die Unterkategorien nimmt der Fremdschlüssel mit (`on delete cascade`);
      // hier steht nur die Hauptkategorie.
      await db.delete(categories).where(eq(categories.id, id))

      // Die Dokumente sind jetzt unsortiert – mit dieser Angabe wandern ihre
      // Dateien in den Ordner „Unsortiert".
      await relocateDocuments(affected.map((document) => ({ ...document, categoryId: null })))

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
        {
          categoryId: id,
          name: category.name,
          subcategories: children.length,
          unsorted: affected.length,
        },
        'Kategorie gelöscht',
      )
      return reply.send({ unsorted: affected.length, subcategories: children.length })
    },
  )
}

export default categoryRoutes
