import type {
  Category,
  DocumentDetail,
  ManagedDocument,
  UpdateDocumentInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
 * Die Datei liegt hinter der Anmeldung – der Browser schickt das Cookie bei
 * einem normalen <img>- oder <a>-Aufruf mit, weil es dieselbe Site ist.
 */
export function fileUrl(id: string, download = false): string {
  return `${API_BASE}/api/documents/${id}/file${download ? '?download=1' : ''}`
}

export type { Category, DocumentDetail, ManagedDocument, UpdateDocumentInput }
export { ApiRequestError }
