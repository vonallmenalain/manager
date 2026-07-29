import { API_ERROR_CODES, createUserSchema } from '@manager/shared'
import { asc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { apiError, validationError } from '../lib/errors.js'
import { createUser, toPublicUser } from '../lib/users.js'

const userRoutes: FastifyPluginAsync = async (fastify) => {
  /** Alle Haushaltsmitglieder – gebraucht für 'Zuständig'-Auswahl und Avatare. */
  fastify.get('/api/users', { preHandler: [fastify.requireAuth] }, async (_request, reply) => {
    const rows = await db.select().from(users).orderBy(asc(users.createdAt))
    return reply.send({ users: rows.map(toPublicUser) })
  })

  /**
   * Ein Mitglied anlegen darf nur der Verwalter des Haushalts.
   *
   * Vorher durfte es jeder – bei zwei Personen schien eine Unterscheidung
   * Bürokratie. Ein neues Konto ist aber der eine Vorgang, der Zugang schafft,
   * und wer ihn auslöst, sollte derselbe sein, der die App auch betreibt.
   */
  fastify.post('/api/users', { preHandler: [fastify.requireAdmin] }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send(validationError(parsed.error))
    }

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1)

    if (existing.length > 0) {
      return reply.status(409).send(
        apiError(API_ERROR_CODES.validationFailed, 'Bitte die markierten Felder prüfen.', {
          email: 'Diese E-Mail-Adresse wird bereits verwendet.',
        }),
      )
    }

    const user = await createUser(parsed.data)
    request.log.info({ userId: user.id, by: request.user?.id }, 'Nutzer angelegt')
    return reply.status(201).send({ user: toPublicUser(user) })
  })
}

export default userRoutes
