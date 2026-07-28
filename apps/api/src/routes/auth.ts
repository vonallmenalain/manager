import { randomBytes } from 'node:crypto'

import { API_ERROR_CODES, changePasswordSchema, loginSchema } from '@manager/shared'
import { eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { hashPassword, verifyPassword } from '../auth/password.js'
import {
  createSession,
  destroyAllSessionsForUser,
  destroySession,
  SESSION_COOKIE,
} from '../auth/session.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { apiError, unauthorized, validationError } from '../lib/errors.js'
import { toPublicUser } from '../lib/users.js'
import { clearSessionCookie, sessionCookieOptions } from '../plugins/auth.js'

/**
 * Dummy-Hash für Logins mit unbekannter E-Mail. Ohne ihn wäre die Antwort
 * messbar schneller als bei existierenden Konten – und damit ein Weg,
 * gültige Adressen zu erraten. Er wird einmalig aus Zufall erzeugt, damit
 * die Prüfung garantiert dieselbe Arbeit leistet wie ein echter Vergleich.
 */
let dummyHash: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHash
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/auth/login',
    {
      config: {
        // Ein Haushalt tippt sich nicht 10-mal in 5 Minuten vertippt –
        // ein Angreifer aus dem Netz schon.
        rateLimit: { max: 10, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send(validationError(parsed.error))
      }

      const { email, password } = parsed.data
      const found = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const user = found[0]

      const passwordOk = user
        ? await verifyPassword(user.passwordHash, password)
        : await verifyPassword(await getDummyHash(), password)

      if (!user || !passwordOk) {
        return reply
          .status(401)
          .send(
            apiError(
              API_ERROR_CODES.invalidCredentials,
              'E-Mail oder Passwort stimmt nicht.',
            ),
          )
      }

      const session = await createSession(user.id, request.headers['user-agent'])
      reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))

      return reply.send({ user: toPublicUser(user) })
    },
  )

  fastify.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await destroySession(token)
    clearSessionCookie(reply)
    return reply.status(204).send()
  })

  fastify.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.status(401).send(unauthorized())
    return reply.send({ user: toPublicUser(request.user) })
  })

  fastify.post(
    '/api/auth/password',
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const user = request.user
      if (!user) return reply.status(401).send(unauthorized())

      const parsed = changePasswordSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send(validationError(parsed.error))
      }

      const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword)
      if (!ok) {
        return reply.status(400).send(
          apiError(API_ERROR_CODES.validationFailed, 'Bitte die markierten Felder prüfen.', {
            currentPassword: 'Aktuelles Passwort stimmt nicht.',
          }),
        )
      }

      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(parsed.data.newPassword),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id))

      // Alle Geräte abmelden und dieses eine sofort wieder anmelden: Wer das
      // Passwort ändert, will in der Regel genau das erreichen.
      await destroyAllSessionsForUser(user.id)
      const session = await createSession(user.id, request.headers['user-agent'])
      reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))

      return reply.status(204).send()
    },
  )
}

export default authRoutes
