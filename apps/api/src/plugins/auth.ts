import type { CookieSerializeOptions } from '@fastify/cookie'
import { isAdminEmail } from '@manager/shared'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { SESSION_COOKIE, validateSession } from '../auth/session.js'
import type { User } from '../db/schema.js'
import { env, isProduction } from '../env.js'
import { forbidden, unauthorized } from '../lib/errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Vom auth-Plugin gesetzt, wenn ein gültiges Sitzungs-Cookie vorlag. */
    user?: User
  }
  interface FastifyInstance {
    /** Als preHandler verwenden, um eine Route anmeldepflichtig zu machen. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Wie requireAuth, zusätzlich dem Verwalter des Haushalts vorbehalten. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export function sessionCookieOptions(expires: Date): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    // 'lax' genügt, weil manager.alae.app und manager-api.alae.app dieselbe Registrable
    // Domain teilen und damit als same-site gelten. Das erspart uns
    // SameSite=None und alle Probleme mit Third-Party-Cookie-Blockern.
    sameSite: 'lax',
    path: '/',
    domain: env.COOKIE_DOMAIN,
    expires,
  }
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    domain: env.COOKIE_DOMAIN,
  })
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', undefined)

  // Läuft für jeden Request: die Sitzung wird einmal aufgelöst und steht danach
  // sowohl optionalen als auch pflichtigen Routen zur Verfügung.
  fastify.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return

    const result = await validateSession(token)
    if (!result) {
      clearSessionCookie(reply)
      return
    }

    request.user = result.user

    if (result.renewedUntil) {
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(result.renewedUntil))
    }
  })

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.status(401).send(unauthorized())
    }
  })

  // Die Prüfung gehört hierher und nicht nur in die Oberfläche: Ein
  // ausgeblendeter Knopf ist keine Sperre, die Adresse der Route steht in
  // jedem Netzwerk-Reiter.
  fastify.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.status(401).send(unauthorized())
      return
    }
    if (!isAdminEmail(request.user.email)) {
      await reply.status(403).send(forbidden())
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
