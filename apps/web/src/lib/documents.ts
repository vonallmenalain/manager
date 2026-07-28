import type {
  Category,
  DocumentDetail,
  ManagedDocument,
  UpdateDocumentInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, API_BASE, ApiRequestError } from './api'

export interface DocumentFilters {
  q?: string
  status?: string
  categoryId?: string
  assignedTo?: string
  year?: number
  pending?: boolean
}

function toQueryString(filters: DocumentFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue
    params.set(key, value === true ? '1' : String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useDocuments(filters: DocumentFilters) {
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: () => api.listDocuments(toQueryString(filters)),
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

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: api.listCategories,
    // Kategorien ändern sich praktisch nie – eine Stunde Ruhe reicht.
    staleTime: 60 * 60 * 1000,
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
    mutationFn: ({ file, allowDuplicate }: { file: File; allowDuplicate?: boolean }) =>
      api.uploadDocument(file, allowDuplicate),
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

export type { Category, DocumentDetail, ManagedDocument, UpdateDocumentInput }
export { ApiRequestError }
