import type { FastifyPluginAsync } from 'fastify'

import { APP_VERSION } from '../version.js'

const startedAt = Date.now()

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Ohne Anmeldung erreichbar – Cloudflare und Container Station prüfen damit,
   * ob der Dienst lebt. 'uptime' zeigt nebenbei, ob Watchtower gerade neu
   * deployt hat: nach einem Update steht die Zahl wieder bei fast null.
   */
  fastify.get('/api/health', async (_request, reply) => {
    return reply.send({
      status: 'ok' as const,
      version: APP_VERSION,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    })
  })
}

export default healthRoutes
