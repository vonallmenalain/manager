import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './data/manager.sqlite',
  },
  // Explizite, im Repo eingecheckte SQL-Migrationen statt automatischem Push:
  // Auf einem produktiven NAS will man vor jedem Deploy sehen, was passiert.
  strict: true,
  verbose: true,
})
