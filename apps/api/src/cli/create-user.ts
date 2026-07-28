/**
 * Notfall-Werkzeug, falls man sich aussperrt oder die Ersteinrichtung im
 * Browser nicht möglich ist:
 *
 *   docker exec -it manager-api node dist/cli/create-user.js \
 *     --name "Alain" --email "alain@example.ch" --password "..."
 *
 * Im Normalfall werden Konten über die App angelegt.
 */
import { parseArgs } from 'node:util'

import { createUserSchema } from '@manager/shared'
import { eq } from 'drizzle-orm'

import { hashPassword } from '../auth/password.js'
import { closeDb, db, runMigrations } from '../db/index.js'
import { users } from '../db/schema.js'
import { createUser } from '../lib/users.js'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
  },
})

const parsed = createUserSchema.safeParse(values)
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`  --${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

runMigrations()

const existing = await db
  .select()
  .from(users)
  .where(eq(users.email, parsed.data.email))
  .limit(1)

if (existing[0]) {
  if (!values['reset-password']) {
    console.error(
      `Konto ${parsed.data.email} existiert bereits. Mit --reset-password das Passwort neu setzen.`,
    )
    closeDb()
    process.exit(1)
  }
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, existing[0].id))
  console.log(`Passwort für ${parsed.data.email} neu gesetzt.`)
} else {
  const user = await createUser(parsed.data)
  console.log(`Konto angelegt: ${user.name} <${user.email}>`)
}

closeDb()
