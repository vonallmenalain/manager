import type { PublicUser } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiRequestError } from './api'

const SESSION_KEY = ['session'] as const

export interface SessionState {
  user: PublicUser | null
  isLoading: boolean
  /** true, solange noch kein einziges Konto existiert – dann zeigt die App die Ersteinrichtung. */
  needsSetup: boolean
  /**
   * Das Backend antwortet gar nicht. Muss getrennt behandelt werden: Sonst
   * landet man auf dem Anmeldebildschirm und hält sein Passwort für falsch,
   * obwohl die Anfrage nie beim Server ankam.
   */
  connectionError: boolean
  retry: () => void
}

export function useSession(): SessionState {
  const sessionQuery = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const { user } = await api.me()
        return user
      } catch (error) {
        // 401 ist hier der Normalfall (nicht angemeldet), kein Fehler.
        if (error instanceof ApiRequestError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  // Nur nachfragen, wenn niemand angemeldet ist – wer drin ist, hat ein Konto.
  const isLoggedOut = sessionQuery.isSuccess && sessionQuery.data === null

  const setupQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: api.setupStatus,
    enabled: isLoggedOut,
    retry: false,
  })

  const connectionError =
    sessionQuery.isError &&
    sessionQuery.error instanceof ApiRequestError &&
    sessionQuery.error.code === 'network_error'

  return {
    user: sessionQuery.data ?? null,
    isLoading: sessionQuery.isLoading || (isLoggedOut && setupQuery.isLoading),
    needsSetup: setupQuery.data?.needsSetup ?? false,
    connectionError,
    retry: () => {
      void sessionQuery.refetch()
      void setupQuery.refetch()
    },
  }
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.login,
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_KEY, user)
    },
  })
}

export function useSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.setup,
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_KEY, user)
      void queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      // Auch bei Fehler alles verwerfen: Der Nutzer wollte abmelden, und
      // zwischengespeicherte Daten dürfen danach nicht mehr sichtbar sein.
      queryClient.setQueryData(SESSION_KEY, null)
      queryClient.clear()
    },
  })
}
