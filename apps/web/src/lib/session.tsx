import type { PublicUser } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, ApiRequestError } from './api'
import { istVerbindungsfehler } from './offline/verbindung'
import { abarbeiten, warteschlangeLeeren } from './offline/warteschlange'
import { geraetLeeren } from './offline/zwischenspeicher'

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
   *
   * Steht trotzdem ein `user` da, stammt er vom letzten Mal (siehe
   * `offline/zwischenspeicher.ts`): Dann arbeitet die App mit dem letzten
   * Stand weiter, statt auf den Server zu warten.
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

  // Abgemeldet – etwa weil die Sitzung abgelaufen ist: Dann gehört auch nichts
  // mehr vom letzten Stand auf den Bildschirm oder ins Gerät. Wer sich wieder
  // anmeldet, bekommt alles frisch. Die Warteschlange bleibt; sie geht nach
  // der Anmeldung zum Server (oder wird verworfen, meldet sich jemand
  // anderes an – siehe `Auftrag.benutzer`).
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!isLoggedOut) return
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session' && query.queryKey[0] !== 'setup-status',
    })
  }, [isLoggedOut, queryClient])

  const setupQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: api.setupStatus,
    enabled: isLoggedOut,
    retry: false,
  })

  const connectionError =
    // Auch eine Antwort des Weges statt des Servers – der Cloudflare-Tunnel
    // ohne Gegenstelle – heisst: Der Server ist nicht erreichbar.
    (sessionQuery.isError && istVerbindungsfehler(sessionQuery.error)) ||
    // Ohne Netz fragt React Query gar nicht erst – die Abfrage wartet. Ohne
    // Stand vom letzten Mal gibt es dann nichts, womit die App starten könnte.
    (sessionQuery.isPending && sessionQuery.fetchStatus === 'paused')

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
      // Was liegen blieb, als die Sitzung ablief, geht jetzt zum Server.
      void abarbeiten()
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
      // zwischengespeicherte Daten dürfen danach nicht mehr sichtbar sein –
      // weder in der App noch auf dem Gerät. Was noch nicht übertragen war,
      // geht dabei verloren; wer sich abmeldet, gibt das Gerät aus der Hand.
      warteschlangeLeeren()
      void geraetLeeren()
      queryClient.setQueryData(SESSION_KEY, null)
      queryClient.clear()
    },
  })
}
