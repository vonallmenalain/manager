import { asc } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'

import { db } from '../db/index.js'
import { categories } from '../db/schema.js'

const categoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/categories', { preHandler: [fastify.requireAuth] }, async (_request, reply) => {
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    return reply.send({ categories: rows })
  })
}

export default categoryRoutes
