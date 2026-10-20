import { randomUUID } from 'node:crypto'

import {
  compareNotesInOwnOrder,
  normalizeChecklistRich,
  normalizeForSearch,
  normalizeRich,
  NOTE_SORT_STEP,
  noteQuerySchema,
  parseChecklist,
  placeInOrder,
  reorderNotesSchema,
  upsertNoteSchema,
  type Bereich,
  type Note,
  type NoteColor,
  type NoteKind,
  type UpsertNoteInput,
} from '@manager/shared'
import { and, desc, eq, isNotNull, isNull, like, min, or, type SQL } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { categories, notes, type NoteRow } from '../db/schema.js'
import { notFound, unauthorized, validationError } from '../lib/errors.js'
import { categoryCondition } from '../lib/filters.js'
import { linkNoteFiles } from '../lib/note-files.js'

function toApi(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyRich: row.bodyRich,
    kind: row.kind as NoteKind,
    bereich: row.bereich as Bereich,
    categoryId: row.categoryId,
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    shared: row.shared,
    color: row.color as NoteColor,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Wer eine Notiz sehen darf: wer sie angelegt hat, und bei geteilten alle.
 *
 * Steht bewusst in jeder Abfrage, auch beim Ändern und Löschen. Sonst liesse
 * sich eine fremde Notiz über ihre Kennung erreichen, ohne dass sie je in
 * einer Liste aufgetaucht wäre.
 *
 * Eine Notiz der DocBase kommt immer geteilt an (`upsertNoteSchema`) und fällt
 * damit schon über `shared` an jeden, der die Sammlung öffnen darf – dort gibt
 * es kein „nur für mich", das hier noch einen eigenen Zweig bräuchte.
 */
function visibleTo(userId: string): SQL {
  const condition = or(eq(notes.createdBy, userId), eq(notes.shared, true))
  if (!condition) throw new Error('Sichtbarkeitsbedingung fehlt')
  return condition
}

/**
 * Was noch nicht gelöscht ist. Eine gelöschte Notiz bleibt 30 Tage liegen,
 * damit „Rückgängig" sie zurückholen kann – sonst aber gibt es sie nicht: Sie
 * steht in keiner Liste und lässt sich nicht ändern.
 */
function notDeleted(): SQL {
  return isNull(notes.deletedAt)
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

/**
 * Prüft, ob die gewünschte Kategorie in denselben Bereich gehört wie die Notiz.
 *
 * Eine Notiz der DocBase in einer Schublade des Haushalts wäre über keinen
 * Filter mehr erreichbar – sie läge in einer Liste, die diese Kategorie gar
 * nicht anzeigt. Unbekannte Kennungen fallen aus demselben Grund weg.
 */
async function resolveCategory(
  categoryId: string | null,
  bereich: Bereich,
): Promise<string | null> {
  if (!categoryId) return null
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.bereich, bereich)))
    .limit(1)

  return rows[0]?.id ?? null
}

/**
 * Die Formatierung, die bleibt, wenn eine App ohne Formatierung speichert.
 *
 * Bis das neue Frontend veröffentlicht ist, läuft auf manchem Telefon noch
 * eine App, die das Feld nicht kennt und deshalb gar nicht mitschickt. Wer
 * damit nur das Anheften umschaltet, soll dabei nicht die Formatierung
 * verlieren – wer aber den Text ändert, bekommt ihn unformatiert: Ein
 * Formatfeld zu einem Text, den so niemand formatiert hat, wäre falsch.
 */
async function keptFormatting(
  id: string,
  userId: string,
  kind: NoteKind,
  body: string,
): Promise<string | null> {
  const rows = await db
    .select({ bodyRich: notes.bodyRich })
    .from(notes)
    .where(and(eq(notes.id, id), visibleTo(userId), notDeleted()))
    .limit(1)
  return kind === 'liste'
    ? normalizeChecklistRich(body, rows[0]?.bodyRich)
    : normalizeRich(body, rows[0]?.bodyRich)
}

/**
 * Der Platz für eine neue Notiz: vor allen anderen ihres Bereichs.
 *
 * Wer seine Notizen geordnet hat, findet die neue oben und schiebt sie von
 * dort, wohin sie gehört – unten zwischen lauter Altem fände er sie nicht.
 * Solange niemand verschoben hat, stehen alle auf 0, und die neue Notiz steht
 * ohnehin oben, weil sie die zuletzt bearbeitete ist.
 */
async function topSortOrder(bereich: Bereich): Promise<number> {
  const rows = await db
    .select({ kleinste: min(notes.sortOrder) })
    .from(notes)
    .where(and(eq(notes.bereich, bereich), notDeleted()))
  const kleinste = rows[0]?.kleinste
  return kleinste === null || kleinste === undefined ? 0 : Math.min(0, kleinste - NOTE_SORT_STEP)
}

/**
 * Eine Notiz weiterschreiben – sofern die Person sie sehen darf und sie nicht
 * gelöscht ist. Zurück kommt die neue Zeile oder `undefined`.
 */
async function updateNote(
  id: string,
  userId: string,
  data: UpsertNoteInput,
): Promise<NoteRow | undefined> {
  const { title, body, kind, bereich, categoryId, pinned, shared, color } = data
  const bodyRich =
    data.bodyRich !== undefined ? data.bodyRich : await keptFormatting(id, userId, kind, body)
  const updated = await db
    .update(notes)
    .set({
      title,
      body,
      bodyRich,
      kind,
      bereich,
      categoryId: await resolveCategory(categoryId, bereich),
      pinned,
      shared,
      color,
      searchText: searchTextFor(kind, title, body),
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    // Die Bedingung prüft den Stand vor der Änderung: Eine fremde private
    // Notiz lässt sich damit nicht durch Mitschicken von shared aufbrechen.
    .where(and(eq(notes.id, id), visibleTo(userId), notDeleted()))
    .returning()

  const row = updated[0]
  if (row) await linkNoteFiles(row.id, userId, row.bereich as Bereich, row.bodyRich)
  return row
}

const noteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/notes', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = noteQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    // Der Bereich steht wie bei den Dokumenten zuerst und hat keinen Ausweg:
    // Der Haushalt sieht nie eine Notiz der DocBase und umgekehrt.
    const conditions: SQL[] = [
      visibleTo(user.id),
      eq(notes.bereich, parsed.data.bereich),
      notDeleted(),
    ]
    if (parsed.data.q) {
      // Dieselbe Vereinheitlichung wie bei den Dokumenten – „PRÄMIE" und
      // „praemie" sollen überall dasselbe finden.
      conditions.push(like(notes.searchText, `%${normalizeForSearch(parsed.data.q)}%`))
    }

    // Derselbe Filter wie über den Dokumenten daneben, samt Unterkategorien:
    // In der DocBase stehen Notiz und Dokument in einer Liste, und ein Häkchen
    // darf nicht die Hälfte davon anders behandeln.
    const kategorien = await categoryCondition(notes.categoryId, parsed.data.categoryId)
    if (kategorien) conditions.push(kategorien)

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

    // Mit der Kennung des Geräts kann dieselbe Notiz zweimal ankommen: Die
    // Warteschlange wiederholt eine Anfrage, deren Antwort im Funkloch
    // verloren ging. Dann steht sie schon da und wird nur weitergeschrieben.
    if (parsed.data.id) {
      const vorhanden = await db
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.id, parsed.data.id))
        .limit(1)
      if (vorhanden[0]) {
        const row = await updateNote(parsed.data.id, user.id, parsed.data)
        // Gelöscht oder fremd und privat – für diese Person gibt es sie nicht.
        if (!row) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
        return reply.send({ note: toApi(row) })
      }
    }

    const { title, body, bodyRich, kind, bereich, categoryId, pinned, shared, color } = parsed.data
    const inserted = await db
      .insert(notes)
      .values({
        id: parsed.data.id ?? randomUUID(),
        title,
        body,
        // Eine App ohne Formatierung schickt das Feld gar nicht – dann ist die
        // neue Notiz eben unformatiert.
        bodyRich: bodyRich ?? null,
        kind,
        bereich,
        categoryId: await resolveCategory(categoryId, bereich),
        pinned,
        sortOrder: await topSortOrder(bereich),
        shared,
        color,
        searchText: searchTextFor(kind, title, body),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning()

    const row = inserted[0]
    if (!row) throw new Error('Notiz konnte nicht gespeichert werden')
    // Dateien, die der Text nennt, gehören ab jetzt zu dieser Notiz.
    await linkNoteFiles(row.id, user.id, row.bereich as Bereich, row.bodyRich)
    return reply.status(201).send({ note: toApi(row) })
  })

  fastify.patch('/api/notes/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const parsed = upsertNoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const row = await updateNote(id, user.id, parsed.data)
    if (!row) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.send({ note: toApi(row) })
  })

  /**
   * Die eigene Reihenfolge. Geschickt wird die neue Folge der Notizen, die
   * man gerade sieht – bei einer Suche oder einem Filter nur ein Teil davon.
   *
   * Zuerst bekommt jede sichtbare Notiz des Bereichs ihren heutigen Platz als
   * Zahl (10, 20, 30 …): Solange niemand verschoben hat, stehen alle auf 0, und
   * erst so lässt sich eine einzelne zwischen zwei andere setzen. Dann nehmen
   * die geschickten Notizen die Plätze ein, die sie zusammen schon hatten – nur
   * in der neuen Folge (`placeInOrder`). Was die Anfrage nicht nennt, bleibt
   * stehen, auch wenn es auf dem anderen Gerät eben erst dazukam.
   *
   * Verschieben ist kein Bearbeiten: `updatedAt` bleibt, wie es ist.
   */
  fastify.put('/api/notes/reihenfolge', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = reorderNotesSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const rows = await db
      .select({
        id: notes.id,
        pinned: notes.pinned,
        sortOrder: notes.sortOrder,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(visibleTo(user.id), eq(notes.bereich, parsed.data.bereich), notDeleted()))

    const bisher = [...rows].sort(compareNotesInOwnOrder)
    const reihenfolge = placeInOrder(
      bisher.map((row) => row.id),
      parsed.data.ids,
    )
    const platzVorher = new Map(bisher.map((row) => [row.id, row.sortOrder]))

    db.transaction((tx) => {
      for (const [index, id] of reihenfolge.entries()) {
        const platz = (index + 1) * NOTE_SORT_STEP
        if (platzVorher.get(id) === platz) continue
        tx.update(notes).set({ sortOrder: platz }).where(eq(notes.id, id)).run()
      }
    })

    return reply.status(204).send()
  })

  /**
   * Löschen – zunächst nur zum Schein: Die Notiz verschwindet aus jeder Liste,
   * bleibt aber samt ihren Dateien liegen, damit „Rückgängig" sie
   * zurückholen kann. Endgültig weg ist sie nach 30 Tagen (siehe index.ts).
   */
  fastify.delete('/api/notes/:id', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const deleted = await db
      .update(notes)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(notes.id, id), visibleTo(user.id), notDeleted()))
      .returning({ id: notes.id })

    if (deleted.length === 0) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.status(204).send()
  })

  /** „Rückgängig" nach dem Löschen: Die Notiz steht wieder da, wo sie stand. */
  fastify.post('/api/notes/:id/wiederherstellen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const { id } = request.params as { id: string }
    const restored = await db
      .update(notes)
      .set({ deletedAt: null })
      .where(and(eq(notes.id, id), visibleTo(user.id), isNotNull(notes.deletedAt)))
      .returning()

    const row = restored[0]
    if (!row) return reply.status(404).send(notFound('Notiz nicht gefunden.'))
    return reply.send({ note: toApi(row) })
  })
}

export default noteRoutes
