import { API_ERROR_CODES, type ApiError } from '@manager/shared'
import type { ZodError } from 'zod'

export function apiError(
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}) } }
}

export function unauthorized(message = 'Bitte zuerst anmelden.'): ApiError {
  return apiError(API_ERROR_CODES.unauthorized, message)
}

export function forbidden(message = 'Dafür ist der Verwalter des Haushalts zuständig.'): ApiError {
  return apiError(API_ERROR_CODES.forbidden, message)
}

export function notFound(message = 'Nicht gefunden.'): ApiError {
  return apiError(API_ERROR_CODES.notFound, message)
}

export function internalError(message = 'Unerwarteter Fehler. Bitte nochmals versuchen.'): ApiError {
  return apiError(API_ERROR_CODES.internal, message)
}

/**
 * Übersetzt einen Zod-Fehler in die einheitliche API-Fehlerform. Pro Feld wird
 * nur die erste Meldung übernommen – mehr als eine Zeile pro Eingabefeld kann
 * ein Formular auf dem Handy ohnehin nicht sinnvoll anzeigen.
 */
export function validationError(error: ZodError): ApiError {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in fields)) fields[key] = issue.message
  }
  return apiError(
    API_ERROR_CODES.validationFailed,
    'Bitte die markierten Felder prüfen.',
    fields,
  )
}
