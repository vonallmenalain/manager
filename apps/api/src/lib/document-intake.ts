import { buildSearchText, type Bereich, type DocumentStatus } from '@manager/shared'
import { eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { documents, users, type DocumentRow } from '../db/schema.js'
import { ocrWorker } from '../ocr/index.js'
import { categoryFolderNames } from './categories.js'
import { logActivity } from './documents.js'
import { buildStoragePath, commitUpload, extensionFor, type StoredUpload } from './storage.js'

/**
 * Der letzte Schritt jedes Uploads: aus einer zwischengespeicherten Datei wird
 * ein Dokument in der Ablage.
 *
 * Steht hier und nicht in der Dokumenten-Route, weil es zwei Wege in die
 * Ablage gibt: das gewöhnliche Hochladen und den Import einer Rechnung im
 * Bereich Haus. Beide sollen dieselbe Ordnerstruktur, denselben
 * Verlaufseintrag und dieselbe Texterkennung bekommen – zwei Fassungen davon
 * liefen unweigerlich auseinander, und die zweite fiele erst auf, wenn eine
 * Rechnung nicht mehr auffindbar wäre.
 *
 * Was hier nicht steht: die Prüfung auf Doppel und der Umgang mit einer zu
 * grossen Datei. Beides gehört zum Weg dorthin und wird an jeder Stelle anders
 * beantwortet – beim Hochladen fragt die App nach, beim Import genügt der
 * Hinweis, dass die Rechnung schon abgelegt ist.
 */
export interface DocumentIntake {
  bereich: Bereich
  /** Wird vorab vergeben, weil er im Dateipfad steckt. */
  documentId: string
  stored: StoredUpload
  mimeType: string
  filename: string
  title: string
  /** Datum auf dem Dokument – beim Hochladen heute, beim Import das der Rechnung. */
  docDate: string
  categoryId: string | null
  assignedTo: string | null
  status: DocumentStatus
  userId: string
  /** Absender und Betrag, wo sie schon feststehen. */
  vendor?: string | null
  amountCents?: number | null
  /** Der Satz für den Verlauf. Ohne Angabe „… hochgeladen". */
  activity?: string
}

export async function intakeDocument(intake: DocumentIntake): Promise<DocumentRow> {
  const { categoryName, parentCategoryName } = await categoryFolderNames(
    intake.bereich,
    intake.categoryId,
  )

  // Eine Zuständigkeit, die es nicht gibt, wird zu „beide" – eine Fremdschlüssel-
  // verletzung mitten im Upload wäre die schlechtere Antwort.
  let assignedTo: string | null = null
  if (intake.assignedTo) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, intake.assignedTo))
      .limit(1)
    assignedTo = rows[0]?.id ?? null
  }

  // Der Kategoriename gehört von Anfang an in den Pfad: Wer die Kategorie
  // schon vorher festlegt, soll die Datei nicht erst unter „Unsortiert"
  // ablegen und beim ersten Bearbeiten dorthin verschieben lassen.
  const storagePath = buildStoragePath({
    docDate: intake.docDate,
    categoryName,
    parentCategoryName,
    title: intake.title,
    documentId: intake.documentId,
    extension: extensionFor(intake.mimeType, intake.filename),
  })

  await commitUpload(intake.bereich, intake.stored.tempPath, storagePath)

  const inserted = await db
    .insert(documents)
    .values({
      id: intake.documentId,
      title: intake.title,
      storagePath,
      mimeType: intake.mimeType,
      sizeBytes: intake.stored.sizeBytes,
      sha256: intake.stored.sha256,
      uploadedBy: intake.userId,
      bereich: intake.bereich,
      docDate: intake.docDate,
      categoryId: categoryName === null ? null : intake.categoryId,
      assignedTo,
      status: intake.status,
      vendor: intake.vendor ?? null,
      amountCents: intake.amountCents ?? null,
      searchText: buildSearchText({ title: intake.title, vendor: intake.vendor ?? null }),
    })
    .returning()

  const row = inserted[0]
  if (!row) throw new Error('Dokument konnte nicht gespeichert werden')

  await logActivity(
    intake.documentId,
    intake.userId,
    'upload',
    intake.activity ?? `„${intake.title}" hochgeladen`,
  )

  // Sofort wecken statt bis zum nächsten Durchlauf zu warten: Ein Dokument
  // soll durchsuchbar sein, bevor man es überhaupt fertig kategorisiert hat.
  ocrWorker?.notify()

  return row
}
