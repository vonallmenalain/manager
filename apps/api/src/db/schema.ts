import { sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
