import { timingSafeEqual } from 'node:crypto'

import { API_ERROR_CODES, setupSchema } from '@manager/shared'
import type { FastifyPluginAsync } from 'fastify'

import { createSession, SESSION_COOKIE } from '../auth/session.js'
import { env } from '../env.js'
import { apiError, validationError } from '../lib/errors.js'
import { countUsers, createUser, toPublicUser } from '../lib/users.js'
import { sessionCookieOptions } from '../plugins/auth.js'

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual verlangt gleiche Länge – die Längenprüfung selbst verrät
  // nichts Nützliches, der Inhalt wird konstantzeitig verglichen.
  return a.length === b.length && timingSafeEqual(a, b)
}

const setupRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Sagt dem Frontend, ob es den Einrichtungs- oder den Anmeldebildschirm
   * zeigen soll. Verrät nichts Sensibles: dass eine frisch aufgesetzte
   * Instanz noch leer ist, sieht man ohnehin.
   */
  fastify.get('/api/setup/status', async (_request, reply) => {
    const userCount = await countUsers()
    return reply.send({ needsSetup: userCount === 0 })
  })

  fastify.post(
    '/api/setup',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      // Doppelt abgesichert: ohne Token gar nicht, und sobald ein Konto
      // existiert nie wieder – auch dann nicht, wenn die Variable gesetzt bleibt.
      if (!env.SETUP_TOKEN) {
        return reply
          .status(403)
          .send(
            apiError(
              'setup_disabled',
              'Ersteinrichtung ist nicht aktiviert. SETUP_TOKEN am Container setzen.',
            ),
          )
      }

      if ((await countUsers()) > 0) {
        return reply
          .status(403)
          .send(apiError('setup_completed', 'Die Ersteinrichtung ist bereits abgeschlossen.'))
      }

      const parsed = setupSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send(validationError(parsed.error))
      }

      if (!tokensMatch(parsed.data.setupToken, env.SETUP_TOKEN)) {
        return reply.status(403).send(
          apiError(API_ERROR_CODES.validationFailed, 'Bitte die markierten Felder prüfen.', {
            setupToken: 'Token stimmt nicht.',
          }),
        )
      }

      const user = await createUser(parsed.data)
      const session = await createSession(user.id, request.headers['user-agent'])
      reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))

      request.log.info({ userId: user.id }, 'Ersteinrichtung abgeschlossen')
      return reply.status(201).send({ user: toPublicUser(user) })
    },
  )
}

export default setupRoutes
