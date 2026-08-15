import { randomUUID } from 'node:crypto'

import {
  API_ERROR_CODES,
  catchAllSection,
  createShoppingItemSchema,
  createShoppingSectionSchema,
  guessSection,
  nextSectionSortOrder,
  normalizeForSearch,
  reorderShoppingSectionsSchema,
  sameSectionName,
  SECTION_SORT_STEP,
  updateShoppingItemSchema,
  updateShoppingSectionSchema,
  type ShoppingItem,
  type ShoppingSection,
} from '@manager/shared'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import {
  shoppingItems,
  shoppingMemory,
  shoppingSections,
  type ShoppingItemRow,
} from '../db/schema.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'
import { findSection, findSectionByName, listSections } from '../lib/sections.js'

function toApi(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    text: row.text,
    sectionId: row.sectionId,
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
async function rememberedSection(normalized: string): Promise<string | null> {
  const rows = await db
    .select({ sectionId: shoppingMemory.sectionId })
    .from(shoppingMemory)
    .where(eq(shoppingMemory.normalizedText, normalized))
    .limit(1)

  return rows[0]?.sectionId ?? null
}

/** Hält die Zuordnung fest, sobald sie von Hand gesetzt oder bestätigt wurde. */
async function remember(normalized: string, sectionId: string): Promise<void> {
  await db
    .insert(shoppingMemory)
    .values({ normalizedText: normalized, sectionId })
    .onConflictDoUpdate({
      target: shoppingMemory.normalizedText,
      set: { sectionId, updatedAt: new Date().toISOString() },
    })
}

/**
 * Die Abteilung für einen Eintrag, den noch nie jemand einsortiert hat.
 *
 * `guessSection` kennt nur die Namen der Erstausstattung – es rät anhand von
 * Stichwörtern und weiss nichts von den Abteilungen dieses Haushalts. Der
 * geratene Name wird deshalb hier nachgeschlagen: Wurde „Molkerei" in
 * „Kühlregal" umbenannt oder gelöscht, greift der Sammelposten.
 */
function guessSectionId(sections: readonly ShoppingSection[], text: string): string | undefined {
  const guessed = guessSection(text)
  const hit = sections.find((section) => sameSectionName(section.name, guessed))
  return (hit ?? catchAllSection(sections))?.id
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

  /**
   * Die Abteilungen als eigene Abfrage und nicht als Beilage der Liste: Die
   * Einträge holt die App alle zwanzig Sekunden, die Abteilungen ändern sich
   * ein paarmal im Jahr.
   */
  fastify.get('/api/shopping/sections', async (_request, reply) => {
    return reply.send({ sections: await listSections() })
  })

  fastify.post('/api/shopping/sections', async (request, reply) => {
    const parsed = createShoppingSectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { name } = parsed.data
    const existing = await findSectionByName(name)
    if (existing) {
      return reply.status(409).send(
        apiError(API_ERROR_CODES.validationFailed, 'Diese Abteilung gibt es bereits.', {
          name: `„${existing.name}" gibt es bereits.`,
        }),
      )
    }

    // Hinten angehängt, nicht einsortiert: Wo die neue Abteilung im Laden
    // wirklich liegt, weiss nur, wer dort einkauft – und genau dafür gibt es
    // die Pfeile in der Verwaltung.
    const section = {
      id: randomUUID(),
      name,
      sortOrder: nextSectionSortOrder(await listSections()),
    }
    await db.insert(shoppingSections).values(section)

    request.log.info({ sectionId: section.id, name, by: request.user?.id }, 'Abteilung angelegt')
    return reply.status(201).send({ section })
  })

  /**
   * Umbenennen. Die Einträge bleiben, wo sie sind – sie hängen an der Kennung
   * und nicht am Namen.
   */
  fastify.patch('/api/shopping/sections/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await findSection(id)
    if (!before) return reply.status(404).send(notFound('Abteilung nicht gefunden.'))

    const parsed = updateShoppingSectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { name } = parsed.data
    const clash = await findSectionByName(name, id)
    if (clash) {
      return reply.status(409).send(
        apiError(API_ERROR_CODES.validationFailed, 'Diese Abteilung gibt es bereits.', {
          name: `„${clash.name}" gibt es bereits.`,
        }),
      )
    }

    await db.update(shoppingSections).set({ name }).where(eq(shoppingSections.id, id))

    request.log.info({ sectionId: id, from: before.name, to: name }, 'Abteilung umbenannt')
    return reply.send({ section: { ...before, name } })
  })

  /**
   * Die Reihenfolge des Rundgangs, als ganze Liste.
   *
   * Danach stehen die Abteilungen wieder auf 10, 20, 30 … – die Lücken sind
   * der Platz, in den eine neue Abteilung fällt, ohne dass alles neu
   * durchnummeriert werden muss.
   */
  fastify.put('/api/shopping/sections/order', async (request, reply) => {
    const parsed = reorderShoppingSectionsSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const sections = await listSections()
    const known = new Set(sections.map((section) => section.id))
    const gewuenscht = parsed.data.ids.filter((id) => known.has(id))

    // Was der Absender nicht kannte, hängt hinten an: Am anderen Gerät kann in
    // der Zwischenzeit eine Abteilung dazugekommen sein, und die soll dieser
    // Griff nicht löschen – neue Abteilungen stehen ohnehin am Ende.
    const gesehen = new Set(gewuenscht)
    const reihenfolge = [
      ...gewuenscht,
      ...sections.filter((section) => !gesehen.has(section.id)).map((section) => section.id),
    ]

    for (const [index, id] of reihenfolge.entries()) {
      await db
        .update(shoppingSections)
        .set({ sortOrder: (index + 1) * SECTION_SORT_STEP })
        .where(eq(shoppingSections.id, id))
    }

    return reply.send({ sections: await listSections() })
  })

  /**
   * Löschen. Die Einträge gehen dabei nicht verloren, sondern wandern in den
   * Sammelposten – zusammen mit dem, was die Liste über sie gelernt hat.
   *
   * Die letzte Abteilung bleibt stehen: Ohne sie gäbe es keinen Ort mehr für
   * den nächsten Eintrag.
   */
  fastify.delete('/api/shopping/sections/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const sections = await listSections()
    const section = sections.find((eintrag) => eintrag.id === id)
    if (!section) return reply.status(404).send(notFound('Abteilung nicht gefunden.'))

    const ziel = catchAllSection(sections, id)
    if (!ziel) {
      return reply
        .status(409)
        .send(
          apiError(
            API_ERROR_CODES.validationFailed,
            'Die letzte Abteilung lässt sich nicht löschen.',
          ),
        )
    }

    const verschoben = await db
      .update(shoppingItems)
      .set({ sectionId: ziel.id })
      .where(eq(shoppingItems.sectionId, id))
      .returning({ id: shoppingItems.id })

    await db
      .update(shoppingMemory)
      .set({ sectionId: ziel.id })
      .where(eq(shoppingMemory.sectionId, id))

    await db.delete(shoppingSections).where(eq(shoppingSections.id, id))

    request.log.info(
      { sectionId: id, name: section.name, moved: verschoben.length, into: ziel.name },
      'Abteilung gelöscht',
    )
    return reply.send({ moved: verschoben.length, into: ziel.name })
  })

  fastify.post('/api/shopping', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = createShoppingItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const sections = await listSections()
    const gewuenscht = parsed.data.sectionId
    if (gewuenscht && !sections.some((section) => section.id === gewuenscht)) {
      return reply.status(400).send(
        apiError(API_ERROR_CODES.validationFailed, 'Diese Abteilung gibt es nicht.', {
          sectionId: 'Diese Abteilung gibt es nicht.',
        }),
      )
    }

    const normalized = normalizeForSearch(parsed.data.text)
    const sectionId =
      gewuenscht ??
      (await rememberedSection(normalized)) ??
      guessSectionId(sections, parsed.data.text)

    // Unerreichbar, solange die letzte Abteilung nicht gelöscht werden kann –
    // aber ein Eintrag ohne Abteilung wäre ein Eintrag, den die Liste nicht
    // mehr anzeigen könnte.
    if (!sectionId) throw new Error('Es gibt keine Abteilung, in die der Eintrag passt')

    if (gewuenscht) await remember(normalized, gewuenscht)

    const inserted = await db
      .insert(shoppingItems)
      .values({
        id: randomUUID(),
        text: parsed.data.text,
        normalizedText: normalized,
        sectionId,
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
    if (changes.sectionId !== undefined) {
      if (!(await findSection(changes.sectionId))) {
        return reply.status(400).send(
          apiError(API_ERROR_CODES.validationFailed, 'Diese Abteilung gibt es nicht.', {
            sectionId: 'Diese Abteilung gibt es nicht.',
          }),
        )
      }

      update.sectionId = changes.sectionId
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
      if (key) await remember(key, changes.sectionId)
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
