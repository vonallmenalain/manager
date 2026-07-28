import type {
  Category,
  CreateUserInput,
  DocumentDetail,
  Health,
  LoginInput,
  ManagedDocument,
  PublicUser,
  SetupInput,
  UpdateDocumentInput,
} from '@manager/shared'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

/** Für Adressen, die der Browser direkt lädt (Bilder, Downloads). */
export const API_BASE = API_URL

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
        // Nur bei JSON selbst setzen. Bei FormData muss der Browser den
        // content-type samt multipart-Grenze bestimmen – setzt man ihn hier,
        // kann der Server den Datenstrom nicht mehr zerlegen.
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
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

  listCategories: () => request<{ categories: Category[] }>('/api/categories'),

  listDocuments: (query = '') =>
    request<{ documents: ManagedDocument[]; total: number }>(`/api/documents${query}`),

  getDocument: (id: string) => request<{ document: DocumentDetail }>(`/api/documents/${id}`),

  uploadDocument: (file: File, allowDuplicate = false) => {
    const body = new FormData()
    body.append('file', file)
    // Kein content-type setzen: Der Browser muss die multipart-Grenze selbst
    // bestimmen, sonst kann der Server den Datenstrom nicht zerlegen.
    return request<{ document: ManagedDocument }>(
      `/api/documents${allowDuplicate ? '?allowDuplicate=1' : ''}`,
      { method: 'POST', body },
    )
  },

  updateDocument: (id: string, changes: UpdateDocumentInput) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteDocument: (id: string) =>
    request<void>(`/api/documents/${id}`, { method: 'DELETE' }),

  retryOcr: (id: string) =>
    request<{ ocrStatus: string }>(`/api/documents/${id}/ocr`, { method: 'POST' }),
}
