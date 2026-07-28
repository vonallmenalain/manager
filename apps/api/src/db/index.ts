import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { env } from '../env.js'
import * as schema from './schema.js'

const dbDir = resolve(env.DB_DIR)
mkdirSync(dbDir, { recursive: true })

const sqlite: Database.Database = new Database(join(dbDir, 'manager.sqlite'))

// WAL erlaubt Lesen während geschrieben wird – bei zwei Nutzern reicht das
// vollkommen und verhindert die klassischen 'database is locked'-Fehler.
sqlite.pragma('journal_mode = WAL')
// NORMAL statt FULL: ein Stromausfall kann die letzte Transaktion kosten,
// die Datenbank bleibt aber intakt. Auf einem NAS mit USV ein guter Tausch.
sqlite.pragma('synchronous = NORMAL')
sqlite.pragma('foreign_keys = ON')
// Wartet statt sofort zu scheitern, falls doch einmal zwei Schreiber kollidieren.
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })

/**
 * Migrationen laufen beim Start des Containers – damit ist ein Deploy über
 * Watchtower ein einziger Schritt und braucht keinen manuellen Eingriff.
 */
export function runMigrations(): void {
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
  migrate(db, { migrationsFolder })
}

export function closeDb(): void {
  sqlite.close()
}

export { schema, sqlite }
