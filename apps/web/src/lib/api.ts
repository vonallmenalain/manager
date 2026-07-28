import type {
  CreateUserInput,
  Health,
  LoginInput,
  PublicUser,
  SetupInput,
} from '@manager/shared'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

/**
 * Trägt Code und Feldfehler der API mit – damit kann ein Formular die Meldung
 * direkt am richtigen Eingabefeld anzeigen, statt alles in einen Balken oben zu kippen.
 */
export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.fields = fields ?? {}
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      // Ohne 'include' schickt der Browser das Sitzungs-Cookie nicht an
      // manager-api.alae.app – die häufigste Ursache für 'plötzlich abgemeldet'.
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiRequestError(
      0,
      'network_error',
      'Keine Verbindung zum Server. Bist du offline?',
    )
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const payload: unknown = text ? JSON.parse(text) : null

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code: string; message: string; fields?: Record<string, string> } })
            .error
        : null

    throw new ApiRequestError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Unerwarteter Fehler.',
      error?.fields,
    )
  }

  return payload as T
}

export const api = {
  health: () => request<Health>('/api/health'),

  setupStatus: () => request<{ needsSetup: boolean }>('/api/setup/status'),

  setup: (input: SetupInput) =>
    request<{ user: PublicUser }>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: LoginInput) =>
    request<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: PublicUser }>('/api/auth/me'),

  listUsers: () => request<{ users: PublicUser[] }>('/api/users'),

  createUser: (input: CreateUserInput) =>
    request<{ user: PublicUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
