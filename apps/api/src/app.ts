import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { API_ERROR_CODES, MAX_UPLOAD_BYTES } from '@manager/shared'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

import { env, isProduction } from './env.js'
import { apiError, internalError } from './lib/errors.js'
import authPlugin from './plugins/auth.js'
import authRoutes from './routes/auth.js'
import categoryRoutes from './routes/categories.js'
import documentRoutes from './routes/documents.js'
import financeRoutes from './routes/finance.js'
import healthRoutes from './routes/health.js'
import noteRoutes from './routes/notes.js'
import setupRoutes from './routes/setup.js'
import shoppingRoutes from './routes/shopping.js'
import stromRoutes from './routes/strom.js'
import userRoutes from './routes/users.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // In der Entwicklung lesbar, im Container als JSON für die Log-Sammlung.
      ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    // Hinter cloudflared kommt jeder Request von der Container-IP. Ohne
    // trustProxy würde das Rate-Limit alle Nutzer in einen Topf werfen.
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  })

  await app.register(helmet, {
    // Die API liefert kein HTML aus; CSP gehört auf die Netlify-Seite.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })

  await app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })

  await app.register(cookie, { secret: env.SESSION_SECRET })

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      // Ein Upload pro Anfrage. Mehrfachauswahl im UI schickt mehrere
      // Anfragen – so schlägt bei einer defekten Datei nicht alles fehl.
      files: 1,
    },
  })

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  })

  await app.register(authPlugin)

  await app.register(healthRoutes)
  await app.register(setupRoutes)
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(categoryRoutes)
  await app.register(documentRoutes)
  await app.register(shoppingRoutes)
  await app.register(noteRoutes)
  await app.register(financeRoutes)
  await app.register(stromRoutes)

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send(apiError(API_ERROR_CODES.notFound, 'Endpunkt nicht gefunden.'))
  })

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send(
          apiError(
            API_ERROR_CODES.rateLimited,
            'Zu viele Versuche. Bitte einen Moment warten.',
          ),
        )
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send(apiError(error.code ?? 'bad_request', error.message))
    }

    // Interne Fehler werden vollständig geloggt, aber nie nach aussen
    // durchgereicht – Stacktraces gehören nicht ins Frontend.
    request.log.error({ err: error }, 'Unbehandelter Fehler')
    return reply.status(500).send(internalError())
  })

  return app
}
