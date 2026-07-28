import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildApp } from './app.js'
import { deleteExpiredSessions } from './auth/session.js'
import { closeDb, runMigrations } from './db/index.js'
import { backfillSearchText, seedCategories } from './db/seed.js'
import { env } from './env.js'
import { cleanStaleTemporaryFiles } from './lib/storage.js'
import { APP_VERSION } from './version.js'

const HOUR_MS = 60 * 60 * 1000

async function main(): Promise<void> {
  // Beide Volumes anlegen, bevor irgendetwas anderes läuft: Ein fehlender
  // Mount soll sofort und deutlich scheitern, nicht erst beim ersten Upload.
  mkdirSync(resolve(env.STORAGE_DIR), { recursive: true })

  runMigrations()

  const app = await buildApp()

  const seeded = await seedCategories()
  if (seeded > 0) app.log.info({ count: seeded }, 'Start-Kategorien angelegt')

  const backfilled = await backfillSearchText()
  if (backfilled > 0) app.log.info({ count: backfilled }, 'Suchtext nachgetragen')

  const cleanup = setInterval(() => {
    void deleteExpiredSessions()
      .then((count) => {
        if (count > 0) app.log.info({ count }, 'Abgelaufene Sitzungen entfernt')
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Sitzungs-Aufräumen fehlgeschlagen'))

    // Reste abgebrochener Uploads, die älter als sechs Stunden sind.
    void cleanStaleTemporaryFiles(6 * HOUR_MS)
      .then((count) => {
        if (count > 0) app.log.info({ count }, 'Verwaiste Upload-Reste entfernt')
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Aufräumen der Upload-Reste fehlgeschlagen'))
  }, HOUR_MS)
  cleanup.unref()

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Fahre herunter')
    clearInterval(cleanup)
    await app.close()
    closeDb()
    process.exit(0)
  }

  // Watchtower stoppt den Container beim Update mit SIGTERM – hier sauber
  // aufräumen, damit SQLite die WAL-Datei geschlossen zurücklässt.
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(
    { version: APP_VERSION, dbDir: env.DB_DIR, storageDir: env.STORAGE_DIR },
    'Manager API bereit',
  )
}

main().catch((error: unknown) => {
  console.error('Start fehlgeschlagen:', error)
  process.exit(1)
})
