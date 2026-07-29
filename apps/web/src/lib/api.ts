import type {
  Category,
  CreatePaymentInput,
  CreateShoppingItemInput,
  CreateUserInput,
  DocumentDetail,
  Donation,
  FinanceSettings,
  Health,
  IncomeEntry,
  LoginInput,
  ManagedDocument,
  Note,
  PreviewInfo,
  PublicUser,
  SaveMonthInput,
  SetupInput,
  ShoppingItem,
  UpdateDocumentInput,
  UpdateShoppingItemInput,
  UpsertNoteInput,
  YearFigures,
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

/**
 * Holt eine Datei als Blob – über denselben Weg wie jeder andere Aufruf.
 *
 * Nicht der Umweg, für den es aussieht: Ein <img src="https://manager-api…">
 * ist für den Browser eine Anfrage an eine fremde Adresse. Die
 * Sicherheitsrichtlinie der Seite (img-src) erlaubt aber nur die eigene
 * Herkunft – das Bild wurde stumm verworfen, und die Vorschau blieb leer.
 * Über fetch() greift stattdessen connect-src, wo die API bereits eingetragen
 * ist; aus dem Blob wird danach eine blob:-Adresse, die jede Richtlinie
 * durchlässt. Nebenbei ist so sichergestellt, dass das Sitzungs-Cookie
 * mitgeht, egal wo die API einmal liegt.
 */
async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { credentials: 'include', signal })
  } catch {
    throw new ApiRequestError(0, 'network_error', 'Keine Verbindung zum Server. Bist du offline?')
  }

  if (!response.ok) {
    // Der Fehlerkörper ist hier JSON, obwohl ein Bild erwartet wurde.
    let code = 'unknown'
    let message = 'Die Datei konnte nicht geladen werden.'
    try {
      const payload: unknown = await response.json()
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const error = (payload as { error: { code: string; message: string } }).error
        code = error.code
        message = error.message
      }
    } catch {
      // Kein JSON – dann bleibt es bei der allgemeinen Meldung.
    }
    throw new ApiRequestError(response.status, code, message)
  }

  return response.blob()
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

  uploadDocument: (file: File, allowDuplicate = false, title?: string) => {
    const body = new FormData()
    // Der Titel muss vor der Datei stehen: Der Server liest den Datenstrom
    // der Reihe nach und hat beim Empfang der Datei nur die Felder zur Hand,
    // die vorher kamen.
    if (title) body.append('title', title)
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

  restoreDocument: (id: string) =>
    request<{ document: ManagedDocument | null }>(`/api/documents/${id}/wiederherstellen`, {
      method: 'POST',
    }),

  retryOcr: (id: string) =>
    request<{ ocrStatus: string }>(`/api/documents/${id}/ocr`, { method: 'POST' }),

  documentPreview: (id: string) => request<PreviewInfo>(`/api/documents/${id}/preview`),

  documentPreviewPage: (id: string, page: number, signal?: AbortSignal) =>
    requestBlob(`/api/documents/${id}/preview/${page}`, signal),

  documentFile: (id: string, signal?: AbortSignal) =>
    requestBlob(`/api/documents/${id}/file`, signal),

  listShopping: () => request<{ items: ShoppingItem[] }>('/api/shopping'),

  addShoppingItem: (input: CreateShoppingItemInput) =>
    request<{ item: ShoppingItem }>('/api/shopping', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateShoppingItem: (id: string, changes: UpdateShoppingItemInput) =>
    request<{ item: ShoppingItem }>(`/api/shopping/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteShoppingItem: (id: string) =>
    request<void>(`/api/shopping/${id}`, { method: 'DELETE' }),

  clearDoneShoppingItems: () =>
    request<{ removed: number }>('/api/shopping/erledigte-loeschen', { method: 'POST' }),

  listNotes: (search = '') =>
    request<{ notes: Note[] }>(`/api/notes${search ? `?q=${encodeURIComponent(search)}` : ''}`),

  createNote: (note: UpsertNoteInput) =>
    request<{ note: Note }>('/api/notes', { method: 'POST', body: JSON.stringify(note) }),

  updateNote: (id: string, note: UpsertNoteInput) =>
    request<{ note: Note }>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(note) }),

  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),

  getFinanceYear: (year: number) => request<FinanceYear>(`/api/finanzen/${year}`),

  saveFinanceSettings: (year: number, settings: FinanceSettings) =>
    request<FinanceYear>(`/api/finanzen/${year}/einstellungen`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  saveFinanceMonth: (year: number, month: number, input: SaveMonthInput) =>
    request<FinanceYear>(`/api/finanzen/${year}/monat/${month}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  addPayment: (year: number, payment: CreatePaymentInput) =>
    request<FinanceYear>(`/api/finanzen/${year}/zahlungen`, {
      method: 'POST',
      body: JSON.stringify(payment),
    }),

  deleteDonation: (year: number, id: string) =>
    request<FinanceYear>(`/api/finanzen/${year}/zahlungen/${id}`, { method: 'DELETE' }),
}

export interface FinanceYear {
  year: number
  settings: FinanceSettings
  entries: IncomeEntry[]
  donations: Donation[]
  figures: YearFigures
}
