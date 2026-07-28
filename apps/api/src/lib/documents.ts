import { randomUUID } from 'node:crypto'

import {
  DOCUMENT_STATUS_LABELS,
  findSnippet,
  type ActivityAction,
  type DocumentStatus,
  type ManagedDocument,
  type OcrStatus,
} from '@manager/shared'
import { asc, eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { activity, documents, users, type DocumentRow } from '../db/schema.js'

export function toApiDocument(row: DocumentRow, query?: string): ManagedDocument {
  return {
    id: row.id,
    title: row.title,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as DocumentStatus,
    categoryId: row.categoryId,
    assignedTo: row.assignedTo,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    docDate: row.docDate,
    dueDate: row.dueDate,
    amountCents: row.amountCents,
    vendor: row.vendor,
    notes: row.notes,
    hasFile: true,
    ocrStatus: row.ocrStatus as OcrStatus,
    // Nur bei einer Suche: zeigt, an welcher Stelle im erkannten Text der
    // Begriff steht. Beantwortet die Frage „warum ist das ein Treffer?".
    snippet: query && row.ocrText ? findSnippet(row.ocrText, query) : null,
  }
}

export async function logActivity(
  documentId: string,
  userId: string,
  action: ActivityAction,
  summary: string,
): Promise<void> {
  await db.insert(activity).values({
    id: randomUUID(),
    documentId,
    userId,
    action,
    summary,
  })
}

export async function getActivity(documentId: string) {
  const rows = await db
    .select({
      id: activity.id,
      action: activity.action,
      userId: activity.userId,
      userName: users.name,
      summary: activity.summary,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .innerJoin(users, eq(activity.userId, users.id))
    .where(eq(activity.documentId, documentId))
    .orderBy(asc(activity.createdAt))

  return rows.map((row) => ({
    ...row,
    action: row.action as ActivityAction,
  }))
}

/**
 * Formuliert für jede Änderung einen lesbaren deutschen Satz. Bewusst
 * serverseitig: Die Verlaufseinträge sollen auch dann noch verständlich sein,
 * wenn das UI später anders aussieht – sie sind ein Protokoll, keine Anzeige.
 */
export function describeChanges(
  before: DocumentRow,
  after: Partial<DocumentRow>,
  names: Map<string, string>,
): { action: ActivityAction; summary: string }[] {
  const entries: { action: ActivityAction; summary: string }[] = []

  if (after.status !== undefined && after.status !== before.status) {
    const from = DOCUMENT_STATUS_LABELS[before.status as DocumentStatus]
    const to = DOCUMENT_STATUS_LABELS[after.status as DocumentStatus]
    entries.push({ action: 'status_change', summary: `Status von „${from}" auf „${to}" geändert` })
  }

  if (after.assignedTo !== undefined && after.assignedTo !== before.assignedTo) {
    const to = after.assignedTo ? (names.get(after.assignedTo) ?? 'unbekannt') : 'beide'
    entries.push({ action: 'assign', summary: `Zuständigkeit auf ${to} gesetzt` })
  }

  const edits: string[] = []
  if (after.title !== undefined && after.title !== before.title) {
    edits.push(`Titel auf „${after.title}"`)
  }
  if (after.categoryId !== undefined && after.categoryId !== before.categoryId) {
    edits.push('Kategorie')
  }
  if (after.docDate !== undefined && after.docDate !== before.docDate) {
    edits.push(`Datum auf ${after.docDate}`)
  }
  if (after.dueDate !== undefined && after.dueDate !== before.dueDate) {
    edits.push(after.dueDate ? `Fälligkeit auf ${after.dueDate}` : 'Fälligkeit entfernt')
  }
  if (after.amountCents !== undefined && after.amountCents !== before.amountCents) {
    edits.push('Betrag')
  }
  if (after.vendor !== undefined && after.vendor !== before.vendor) {
    edits.push('Absender')
  }
  if (after.notes !== undefined && after.notes !== before.notes) {
    edits.push('Notiz')
  }

  if (edits.length > 0) {
    entries.push({ action: 'edit', summary: `${edits.join(', ')} geändert` })
  }

  return entries
}

export async function loadUserNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, name: users.name }).from(users)
  return new Map(rows.map((row) => [row.id, row.name]))
}

export async function findDocument(id: string): Promise<DocumentRow | undefined> {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
  const row = rows[0]
  // Gelöschte Dokumente liegen im Papierkorb und sind über die API unsichtbar.
  return row && !row.deletedAt ? row : undefined
}
