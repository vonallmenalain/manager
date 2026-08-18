import {
  DEFAULT_BEREICH,
  DOCUMENT_STATUSES,
  type Bereich,
  type Category,
  type DocumentDetail,
  type DocumentStatus,
  type ManagedDocument,
  type UpdateDocumentInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, API_BASE, ApiRequestError, type UploadDetails } from './api'

export interface DocumentFilters {
  /** Welche Sammlung. Ohne Angabe der Haushalt – nie beide zusammen. */
  bereich?: Bereich
  q?: string
  /** Mehrfachauswahl: leer oder fehlend heisst „alle". */
  status?: string[]
  categoryId?: string[]
  assignedTo?: string[]
  /** Hochladedatum von/bis, als JJJJ-MM-TT. */
  uploadedFrom?: string
  uploadedTo?: string
  /** Papierkorb: ohne (Standard), mit oder nur. */
  deleted?: 'ohne' | 'mit' | 'nur'
  year?: number
  pending?: boolean
}

function toQueryString(filters: DocumentFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','))
      continue
    }
    params.set(key, value === true ? '1' : String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Liest gespeicherte Filter und wirft weg, was nicht (mehr) gilt.
 *
 * Im Speicher steht, was eine ältere Fassung hinterlassen hat – etwa der
 * Status `offen`, den es nicht mehr gibt. Bliebe er stehen, zeigte die Liste
 * nichts an, ohne dass man den Grund sähe. Kennungen von Kategorien und
 * Personen lassen sich hier nicht prüfen; dafür steht die Zahl am Filterknopf,
 * und ein Griff setzt alles zurück.
 */
export function sanitizeFilters(raw: unknown): DocumentFilters {
  if (typeof raw !== 'object' || raw === null) return {}
  const gelesen = raw as Record<string, unknown>
  const filters: DocumentFilters = {}

  const texte = (wert: unknown): string[] =>
    Array.isArray(wert) ? wert.filter((eintrag): eintrag is string => typeof eintrag === 'string') : []

  const status = texte(gelesen.status).filter((wert): wert is DocumentStatus =>
    (DOCUMENT_STATUSES as readonly string[]).includes(wert),
  )
  if (status.length > 0) filters.status = status

  const kategorien = texte(gelesen.categoryId)
  if (kategorien.length > 0) filters.categoryId = kategorien

  const zustaendig = texte(gelesen.assignedTo)
  if (zustaendig.length > 0) filters.assignedTo = zustaendig

  const istDatum = (wert: unknown): wert is string =>
    typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert)
  if (istDatum(gelesen.uploadedFrom)) filters.uploadedFrom = gelesen.uploadedFrom
  if (istDatum(gelesen.uploadedTo)) filters.uploadedTo = gelesen.uploadedTo

  if (gelesen.deleted === 'mit' || gelesen.deleted === 'nur') filters.deleted = gelesen.deleted

  return filters
}

/** Wie viele Filter gesetzt sind – für die Zahl am Filterknopf. */
export function countFilters(filters: DocumentFilters): number {
  let count = 0
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'q' || value === undefined || value === '' || value === false) continue
    // 'ohne' ist der Normalfall und kein gesetzter Filter.
    if (key === 'deleted' && value === 'ohne') continue
    // Der Bereich ist kein Filter, den man setzt oder zurücksetzt, sondern
    // die Sammlung, in der man sich befindet.
    if (key === 'bereich') continue
    if (Array.isArray(value)) count += value.length
    else count += 1
  }
  return count
}

/**
 * Dieselbe Abfrage ohne die gesetzten Filter.
 *
 * Suchbegriff und Bereich bleiben stehen. Der Bereich ist kein Filter, den man
 * setzt oder zurücksetzt, sondern die Sammlung, in der man sich befindet –
 * fiele er weg, zeigte der Haushalt Dokumente der DocBase.
 */
export function withoutFilters(filters: DocumentFilters): DocumentFilters {
  const ohne: DocumentFilters = {}
  if (filters.bereich) ohne.bereich = filters.bereich
  if (filters.q) ohne.q = filters.q
  return ohne
}

/**
 * `enabled` ist für die zweite, ungefilterte Abfrage da: Sie läuft erst, wenn
 * die gefilterte Liste leer bleibt – sonst holte jeder Tastendruck im Suchfeld
 * zwei Listen statt einer.
 */
export function useDocuments(filters: DocumentFilters, enabled = true) {
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: () => api.listDocuments(toQueryString(filters)),
    enabled,
    // Beim Tippen im Suchfeld die vorherige Liste stehen lassen, statt sie
    // durch einen Ladezustand zu ersetzen – das flackert sonst bei jedem Zeichen.
    placeholderData: (previous) => previous,
  })
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id as string),
    enabled: Boolean(id),
    // Solange der Text noch gelesen wird, alle drei Sekunden nachfragen –
    // danach von selbst aufhören. So erscheint das Ergebnis ohne Zutun,
    // ohne dass die App dauerhaft pollt.
    refetchInterval: (query) => {
      const status = query.state.data?.document.ocrStatus
      return status === 'pending' || status === 'running' ? 3000 : false
    },
  })
}

export function useCategories(bereich: Bereich = DEFAULT_BEREICH) {
  return useQuery({
    queryKey: ['categories', bereich],
    queryFn: () => api.listCategories(bereich),
    // Kategorien ändern sich praktisch nie – eine Stunde Ruhe reicht.
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Eine neue Kategorie – von überall dort, wo eine ausgewählt wird.
 *
 * Nach dem Anlegen wird die Liste neu geholt, aber nicht die Dokumente: An
 * denen ändert eine leere Kategorie nichts.
 */
export function useCreateCategory(bereich: Bereich = DEFAULT_BEREICH) {
  const queryClient = useQueryClient()
  return useMutation({
    // Ein Objekt statt zweier Parameter: `mutate` reicht genau einen Wert
    // durch, und die Hauptkategorie ist hier so freiwillig wie häufig.
    mutationFn: ({ name, parentId }: { name: string; parentId?: string | null }) =>
      api.createCategory({ name, bereich, parentId: parentId ?? null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })
}

export function useRenameCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameCategory(id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })
}

/**
 * Löschen zieht Dokumente mit: Sie werden unsortiert. Deshalb wird hier alles
 * neu geholt, was eine Kategorie anzeigt – Liste wie Einzelansicht.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['document'] })
    },
  })
}

export function useHouseholdUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: api.listUsers,
    staleTime: 60 * 60 * 1000,
  })
}

export interface UploadResult {
  document: ManagedDocument
}

export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      file,
      allowDuplicate,
      ...details
    }: UploadDetails & {
      file: File
      allowDuplicate?: boolean
    }) => api.uploadDocument(file, allowDuplicate, details),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: UpdateDocumentInput) => api.updateDocument(id, changes),
    onSuccess: (data) => {
      queryClient.setQueryData(['document', id], data)
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

/**
 * Ersetzt die Datei eines Dokuments – der Weg des nachträglichen Zuschneidens.
 *
 * Danach wird alles neu geholt, was die Datei zeigt: Vorschau, Kachelbild und
 * die Liste. Der erkannte Text wird serverseitig verworfen und neu gelesen,
 * deshalb hängt auch die Detailansicht davon ab.
 */
export function useReplaceDocumentFile(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => api.replaceDocumentFile(id, file),
    onSuccess: (data) => {
      queryClient.setQueryData(['document', id], data)
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['preview', id] })
      void queryClient.invalidateQueries({ queryKey: ['preview-page', id] })
      void queryClient.invalidateQueries({ queryKey: ['file-blob', id] })
      void queryClient.invalidateQueries({ queryKey: ['thumbnail', id] })
    },
  })
}

export function useRetryOcr(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.retryOcr(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document', id] })
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

/** Holt ein Dokument aus dem Papierkorb zurück. */
export function useRestoreDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restoreDocument(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['document', id] })
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

/**
 * Adresse der Datei für einen Aufruf, den der Browser selbst übernimmt –
 * Herunterladen oder Öffnen in einem neuen Tab.
 *
 * Für die Vorschau ist sie ungeeignet: Eine solche Adresse in <img> oder
 * <object> verwirft die Sicherheitsrichtlinie der Seite, weil sie auf eine
 * andere Herkunft zeigt. Dafür gibt es useFileBlobUrl.
 */
export function fileUrl(id: string, download = false): string {
  return `${API_BASE}/api/documents/${id}/file${download ? '?download=1' : ''}`
}

/** Sagt, ob und wie viel es von einem Dokument zu sehen gibt. */
export function usePreviewInfo(id: string | undefined) {
  return useQuery({
    queryKey: ['preview', id],
    queryFn: () => api.documentPreview(id as string),
    enabled: Boolean(id),
    // Ein Dokument bekommt nach dem Hochladen keine Seiten mehr dazu.
    staleTime: Infinity,
  })
}

/**
 * Macht aus einem geladenen Blob eine blob:-Adresse und räumt sie wieder auf.
 *
 * Ohne das revoke bliebe jede angeschaute Seite bis zum Neuladen der App im
 * Speicher – bei einem mehrseitigen Scan auf dem Handy schnell spürbar.
 */
function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  return url
}

/**
 * Wie lange geladene Dateien im Zwischenspeicher bleiben.
 *
 * Kurz gehalten, weil hier ganze Bilder liegen und nicht ein paar Zeilen
 * JSON: Wer zurück zur Liste geht und ein anderes Dokument öffnet, soll die
 * Bilder des vorherigen nicht mitschleppen. Fünf Minuten reichen für den
 * Weg 'Detail → Bearbeiten → zurück'.
 */
const BLOB_CACHE_MS = 5 * 60 * 1000

export interface BlobUrlResult {
  url: string | null
  /**
   * Die Datei selbst. Die blob:-Adresse daneben ist zum Anzeigen da – wer die
   * Bytes braucht, nimmt diese hier.
   *
   * Das ist keine Bequemlichkeit, sondern nötig: Die Sicherheitsrichtlinie der
   * Seite erlaubt unter `connect-src` nur die eigene Herkunft und die API. Ein
   * `fetch()` auf eine blob:-Adresse wird davon verworfen – im Browser mit der
   * denkbar wortkargen Meldung „Failed to fetch". Angezeigt werden darf sie
   * trotzdem, dafür steht `blob:` unter `img-src`.
   */
  blob: Blob | undefined
  isLoading: boolean
  isError: boolean
}

/** Die Datei selbst, als blob:-Adresse – für Bilder. */
export function useFileBlobUrl(id: string | undefined, enabled: boolean): BlobUrlResult {
  const query = useQuery({
    queryKey: ['file-blob', id],
    queryFn: ({ signal }) => api.documentFile(id as string, signal),
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
    gcTime: BLOB_CACHE_MS,
    retry: false,
  })

  return {
    url: useObjectUrl(query.data),
    blob: query.data,
    isLoading: query.isPending && enabled,
    isError: query.isError,
  }
}

/**
 * Das Bild einer Kachel, als blob:-Adresse.
 *
 * `enabled` ist hier keine Formsache, sondern der Kern: In der Kachelansicht
 * stehen schnell dreissig Dokumente untereinander, von denen vier zu sehen
 * sind. Geladen wird deshalb erst, was in die Nähe des Bildschirms kommt –
 * siehe useInView.
 */
export function useThumbnailUrl(id: string | undefined, enabled: boolean): BlobUrlResult {
  const query = useQuery({
    queryKey: ['thumbnail', id],
    queryFn: ({ signal }) => api.documentThumbnail(id as string, signal),
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
    gcTime: BLOB_CACHE_MS,
    retry: false,
  })

  return {
    url: useObjectUrl(query.data),
    blob: query.data,
    isLoading: query.isPending && enabled,
    isError: query.isError,
  }
}

function previewPageQuery(id: string | undefined, page: number, enabled: boolean) {
  return {
    queryKey: ['preview-page', id, page],
    // Bewusst ohne Abbruchsignal: Eine gerasterte Seite ist ein paar Dutzend
    // Kilobyte gross. Beim Blättern wandert das Vorausladen der nächsten Seite
    // eine Zeile weiter, und ein Abbruch würde genau die Seite wegwerfen, die
    // im selben Moment angezeigt werden soll – sie müsste sofort neu geholt
    // werden. Beim vollständigen Herunterladen weiter unten lohnt er sich.
    queryFn: () => api.documentPreviewPage(id as string, page),
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
    gcTime: BLOB_CACHE_MS,
    retry: false,
  }
}

/** Eine gerasterte PDF-Seite, als blob:-Adresse. */
export function usePreviewPageUrl(
  id: string | undefined,
  page: number,
  enabled: boolean,
): BlobUrlResult {
  const query = useQuery(previewPageQuery(id, page, enabled))

  return {
    url: useObjectUrl(query.data),
    blob: query.data,
    isLoading: query.isPending && enabled,
    isError: query.isError,
  }
}

/**
 * Holt eine Seite still im Hintergrund, ohne sie anzuzeigen.
 *
 * Bewusst ohne blob:-Adresse: Die entsteht erst, wenn wirklich geblättert
 * wird. Ein Scan mit zwanzig Seiten hätte sonst zwanzig Adressen im Speicher,
 * von denen neunzehn niemand ansieht.
 */
export function usePrefetchPreviewPage(id: string | undefined, page: number, enabled: boolean) {
  useQuery(previewPageQuery(id, page, enabled))
}

export type { Category, DocumentDetail, ManagedDocument, UpdateDocumentInput, UploadDetails }
export { ApiRequestError }
