import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Zeitstempel werden als ISO-8601-Text gespeichert, nicht als Unix-Zahl.
 * Kostet ein paar Bytes, macht die Datenbankdatei aber direkt lesbar –
 * bei einem selbst gehosteten System, das man notfalls von Hand repariert,
 * ist das den Platz wert.
 */
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Farbe für Avatar-Initialen, damit auf einen Blick klar ist wer was gemacht hat. */
  color: text('color').notNull().default('#3b82f6'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    /**
     * Nur der SHA-256-Hash des Tokens liegt in der Datenbank. Wer die DB-Datei
     * in die Hand bekommt, kann sich damit nicht als jemand anderes ausgeben.
     */
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(now),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    /** Hilft beim Aufräumen: 'Pixel 8, Chrome' ist verständlicher als eine ID. */
    userAgent: text('user_agent'),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export type Session = typeof sessions.$inferSelect

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  icon: text('icon').notNull().default('folder'),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: text('created_at').notNull().default(now),
})

export type Category = typeof categories.$inferSelect

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /**
     * Pfad relativ zu STORAGE_DIR. Absolut wäre er nach jedem Umzug der
     * Ablage falsch – so genügt es, eine Umgebungsvariable zu ändern.
     */
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Erkennt Doppel-Uploads, bevor zwei Exemplare derselben Rechnung entstehen. */
    sha256: text('sha256').notNull(),

    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: text('uploaded_at').notNull().default(now),

    /** Datum auf dem Dokument. Beim Upload zunächst das Uploaddatum. */
    docDate: text('doc_date').notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** null heisst "beide zuständig", nicht "niemand". */
    assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('offen'),
    dueDate: text('due_date'),

    amountCents: integer('amount_cents'),
    vendor: text('vendor'),
    notes: text('notes'),

    /**
     * Titel, Absender und Notizen in vereinheitlichter Form: klein
     * geschrieben, Umlaute ausgeschrieben, Akzente entfernt. Nur gegen diese
     * Spalte wird gesucht, damit „PRÄMIE" und „praemie" dasselbe finden.
     */
    searchText: text('search_text').notNull().default(''),

    /**
     * Zustand der Texterkennung – zugleich die Warteschlange. Eine eigene
     * Job-Tabelle wäre hier Ballast: Es gibt genau einen Auftrag pro Dokument,
     * und die Oberfläche muss den Zustand ohnehin am Dokument anzeigen.
     *
     * pending → running → done | failed, dazu 'skipped' für Dateitypen, aus
     * denen sich kein Text gewinnen lässt.
     */
    ocrStatus: text('ocr_status').notNull().default('pending'),
    /** Der erkannte Rohtext, für Textausschnitte in den Suchergebnissen. */
    ocrText: text('ocr_text'),
    /** Wie der Text gewonnen wurde: 'textebene' (schnell) oder 'ocr'. */
    ocrMethod: text('ocr_method'),
    /** Fehlgeschlagene Anläufe. Nach dreien wird nicht weiter versucht. */
    ocrAttempts: integer('ocr_attempts').notNull().default(0),
    ocrError: text('ocr_error'),
    ocrFinishedAt: text('ocr_finished_at'),

    /** Papierkorb statt echtem Löschen – 30 Tage Gnadenfrist. */
    deletedAt: text('deleted_at'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    index('documents_status_idx').on(table.status),
    index('documents_category_idx').on(table.categoryId),
    index('documents_assigned_idx').on(table.assignedTo),
    index('documents_doc_date_idx').on(table.docDate),
    index('documents_sha256_idx').on(table.sha256),
    index('documents_deleted_at_idx').on(table.deletedAt),
    index('documents_search_text_idx').on(table.searchText),
    index('documents_ocr_status_idx').on(table.ocrStatus),
  ],
)

export type DocumentRow = typeof documents.$inferSelect
export type NewDocumentRow = typeof documents.$inferInsert

/**
 * Beantwortet "wer hat wann was hochgeladen" und gibt jedem Dokument eine
 * Verlaufsspur. Bewusst append-only: Einträge werden nie geändert.
 */
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    /** Fertig formulierter deutscher Satz – das UI muss nichts zusammenbauen. */
    summary: text('summary').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [index('activity_document_idx').on(table.documentId, table.createdAt)],
)

export type ActivityRow = typeof activity.$inferSelect

/**
 * Einkaufsliste – eine gemeinsame Liste für den ganzen Haushalt.
 *
 * Bewusst ohne Mengeneinheiten und ohne Rezeptverknüpfung: Was man im Laden
 * braucht, ist eine Zeile Text und ein Häkchen.
 */
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    text: text('text').notNull(),
    /** Vereinheitlicht, um dasselbe Produkt beim nächsten Mal wiederzuerkennen. */
    normalizedText: text('normalized_text').notNull(),
    /** Abteilung im Laden, damit die Liste der Wegführung folgt. */
    section: text('section').notNull().default('Sonstiges'),

    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    doneBy: text('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(now),
    doneAt: text('done_at'),
  },
  (table) => [
    index('shopping_done_idx').on(table.done),
    index('shopping_normalized_idx').on(table.normalizedText),
  ],
)

export type ShoppingItemRow = typeof shoppingItems.$inferSelect

/**
 * Gedächtnis der Einkaufsliste: In welcher Abteilung stand dieser Artikel
 * zuletzt?
 *
 * Bewusst getrennt von den Einträgen selbst. „Erledigte löschen" passiert nach
 * jedem Einkauf – läge die Zuordnung nur an den Einträgen, wäre das Gelernte
 * jedes Mal weg und die Liste würde nie besser werden.
 */
export const shoppingMemory = sqliteTable('shopping_memory', {
  normalizedText: text('normalized_text').primaryKey(),
  section: text('section').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
})

export type ShoppingMemoryRow = typeof shoppingMemory.$inferSelect

/**
 * Notizen. Kurz gehalten – wer eine Gliederung mit Unterseiten braucht,
 * nimmt ein anderes Werkzeug.
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    /** Angeheftete stehen immer oben. */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    color: text('color').notNull().default('default'),

    /** Titel und Text vereinheitlicht – dieselbe Suchlogik wie bei Dokumenten. */
    searchText: text('search_text').notNull().default(''),

    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    index('notes_pinned_idx').on(table.pinned, table.updatedAt),
    index('notes_search_idx').on(table.searchText),
  ],
)

export type NoteRow = typeof notes.$inferSelect
