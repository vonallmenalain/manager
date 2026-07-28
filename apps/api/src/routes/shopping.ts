import { randomUUID } from 'node:crypto'

import {
  createShoppingItemSchema,
  guessSection,
  normalizeForSearch,
  updateShoppingItemSchema,
  type ShoppingItem,
  type StoreSection,
} from '@manager/shared'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { shoppingItems, shoppingMemory, type ShoppingItemRow } from '../db/schema.js'
import { notFound, unauthorized, validationError } from '../lib/errors.js'

function toApi(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    text: row.text,
    section: row.section as StoreSection,
    done: row.done,
    createdBy: row.createdBy,
    doneBy: row.doneBy,
    createdAt: row.createdAt,
    doneAt: row.doneAt,
  }
}

/**
 * Die zuletzt gemerkte Abteilung für diesen Artikel.
 *
 * Damit lernt die Liste ohne Zutun: Wer „Vollmilch" einmal von „Sonstiges"
 * nach „Molkerei" verschiebt, findet es beim nächsten Einkauf gleich richtig.
 */
async function rememberedSection(normalized: string): Promise<StoreSection | null> {
  const rows = await db
    .select({ section: shoppingMemory.section })
    .from(shoppingMemory)
    .where(eq(shoppingMemory.normalizedText, normalized))
    .limit(1)

  return (rows[0]?.section as StoreSection | undefined) ?? null
}

/** Hält die Zuordnung fest, sobald sie von Hand gesetzt oder bestätigt wurde. */
async function remember(normalized: string, section: StoreSection): Promise<void> {
  await db
    .insert(shoppingMemory)
    .values({ normalizedText: normalized, section })
    .onConflictDoUpdate({
      target: shoppingMemory.normalizedText,
      set: { section, updatedAt: new Date().toISOString() },
    })
}

const shoppingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/shopping', async (_request, reply) => {
    const rows = await db
      .select()
      .from(shoppingItems)
      // Älteste zuerst innerhalb einer Abteilung; die Gruppierung nach
      // Abteilung macht die Oberfläche, weil sie die Reihenfolge kennt.
      .orderBy(shoppingItems.done, shoppingItems.createdAt)

    return reply.send({ items: rows.map(toApi) })
  })

  fastify.post('/api/shopping', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = createShoppingItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const normalized = normalizeForSearch(parsed.data.text)
    const section =
      parsed.data.section ?? (await rememberedSection(normalized)) ?? guessSection(parsed.data.text)

    if (parsed.data.section) await remember(normalized, parsed.data.section)

    const inserted = await db
      .insert(shoppingItems)
      .values({
        id: randomUUID(),
        text: parsed.data.text,
        normalizedText: normalized,
        section,
        createdBy: user.id,
      })
      .returning()

    const row = inserted[0]
    if (!row) throw new Error('Eintrag konnte nicht gespeichert werden')
    return reply.status(201).send({ item: toApi(row) })
  })

  fastify.patch('/api/shopping/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const parsed = updateShoppingItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const changes = parsed.data
    const update: Partial<ShoppingItemRow> = {}

    if (changes.text !== undefined) {
      update.text = changes.text
      update.normalizedText = normalizeForSearch(changes.text)
    }
    if (changes.section !== undefined) {
      update.section = changes.section
      // Genau hier lernt die Liste: Eine Korrektur von Hand gilt ab sofort.
      const key =
        update.normalizedText ??
        (
          await db
            .select({ normalizedText: shoppingItems.normalizedText })
            .from(shoppingItems)
            .where(eq(shoppingItems.id, id))
            .limit(1)
        )[0]?.normalizedText

      // Ohne Eintrag gibt es nichts zu merken – sonst entstünde ein
      // Gedächtnis-Eintrag mit leerem Schlüssel, der später alles trifft.
      if (key) await remember(key, changes.section)
    }
    if (changes.done !== undefined) {
      update.done = changes.done
      // Wer abhakt, wird festgehalten – so sieht man, dass der andere den
      // Posten schon geholt hat.
      update.doneBy = changes.done ? user.id : null
      update.doneAt = changes.done ? new Date().toISOString() : null
    }

    const updated = await db
      .update(shoppingItems)
      .set(update)
      .where(eq(shoppingItems.id, id))
      .returning()

    const row = updated[0]
    if (!row) return reply.status(404).send(notFound('Eintrag nicht gefunden.'))
    return reply.send({ item: toApi(row) })
  })

  fastify.delete('/api/shopping/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const deleted = await db
      .delete(shoppingItems)
      .where(eq(shoppingItems.id, id))
      .returning({ id: shoppingItems.id })

    if (deleted.length === 0) return reply.status(404).send(notFound('Eintrag nicht gefunden.'))
    return reply.status(204).send()
  })

  /**
   * Räumt die erledigten Einträge weg – der übliche Abschluss eines Einkaufs.
   * Das Gelernte bleibt erhalten, weil es in einer eigenen Tabelle steht.
   */
  fastify.post('/api/shopping/erledigte-loeschen', async (_request, reply) => {
    const deleted = await db
      .delete(shoppingItems)
      .where(eq(shoppingItems.done, true))
      .returning({ id: shoppingItems.id })

    return reply.send({ removed: deleted.length })
  })
}

export default shoppingRoutes
