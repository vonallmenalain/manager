import { z } from 'zod'

/**
 * Einheitliche Fehlerform über die ganze API. Das Frontend kann damit jeden
 * Fehler gleich behandeln und muss nie raten, wo die Meldung steht.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    /** Maschinenlesbar, z.B. 'invalid_credentials' – für Fallunterscheidung im UI. */
    code: z.string(),
    /** Deutschsprachig und direkt anzeigbar. */
    message: z.string(),
    /** Feldbezogene Validierungsfehler, Schlüssel ist der Feldname. */
    fields: z.record(z.string()).optional(),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /** Sekunden seit Start – nützlich um zu sehen, ob Watchtower neu deployt hat. */
  uptime: z.number(),
})

export type Health = z.infer<typeof healthSchema>

export const API_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  unauthorized: 'unauthorized',
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  rateLimited: 'rate_limited',
  internal: 'internal_error',
} as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES]
