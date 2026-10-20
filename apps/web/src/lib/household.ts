import {
  catchAllSection,
  guessSection,
  sameSectionName,
  type Bereich,
  type CreateShoppingItemInput,
  type Note,
  type PublicUser,
  type ReorderNotesInput,
  type ShoppingItem,
  type ShoppingSection,
  type UpdateShoppingItemInput,
  type UpsertNoteInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from './api'
import {
  einkaufMit,
  notizenMit,
  notizNach,
  type Auftrag,
  type AuftragsInhalt,
  type NotizFilter,
} from './offline/auftraege'
import { einreihen, offeneAuftraege } from './offline/warteschlange'

const SHOPPING_KEY = ['shopping'] as const
const SECTIONS_KEY = ['shopping-sections'] as const

/**
 * Änderungen an Einkaufsliste und Notizen laufen über die Warteschlange
 * (`offline/warteschlange.ts`): Sie stehen sofort auf dem Bildschirm und
 * gehen zum Server, sobald er erreichbar ist – gleich oder nach dem Funkloch.
 *
 * Damit eine Liste vom Server die wartenden Änderungen nicht überschreibt,
 * kommen sie auf jede frisch geholte Liste noch einmal obendrauf
 * (`einkaufMit`, `notizenMit`).
 */

/** Wer gerade angemeldet ist – für „von Annina" an einem Haken, der noch wartet. */
function ich(queryClient: QueryClient): string {
  return queryClient.getQueryData<PublicUser | null>(['session'])?.id ?? ''
}

export function useShoppingList() {
  return useQuery({
    queryKey: SHOPPING_KEY,
    queryFn: async () => {
      const { items } = await api.listShopping()
      return { items: einkaufMit(items, offeneAuftraege()) }
    },
    // Die Liste ist zu zweit in Bewegung: Wer im Laden steht, soll sehen,
    // wenn zuhause noch etwas dazukommt.
    refetchInterval: 20_000,
  })
}

/**
 * Eine Änderung der Einkaufsliste: einreihen und sofort zeigen.
 *
 * Im Laden zählt das mehr als anderswo: Man tippt im Gehen, oft mit einem
 * Balken Empfang. Eine halbe Sekunde Verzögerung pro Häkchen fühlt sich an,
 * als hätte die App den Tipp verschluckt – und man tippt nochmals. Ohne
 * Empfang bleibt der Haken trotzdem stehen und geht später zum Server.
 *
 * `networkMode: 'always'`: Ohne Verbindung hielte React Query die Änderung
 * sonst selbst an, statt sie einzureihen.
 */
function useEinkaufAuftrag<TVariables>(
  auftragAus: (variables: TVariables, queryClient: QueryClient) => AuftragsInhalt | null,
) {
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (variables: TVariables) => {
      const inhalt = auftragAus(variables, queryClient)
      if (!inhalt) return null
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })
      const auftrag = einreihen(inhalt)
      const bisher = queryClient.getQueryData<{ items: ShoppingItem[] }>(SHOPPING_KEY)
      if (bisher) {
        queryClient.setQueryData(SHOPPING_KEY, { items: einkaufMit(bisher.items, [auftrag]) })
      }
      return auftrag
    },
  })
}

/**
 * Die Abteilung, in die ein neuer Eintrag vermutlich kommt – bis der Server
 * mit dem Gedächtnis der Liste entscheidet. Dieselbe Stichwortliste wie dort.
 */
function vermuteteAbteilung(queryClient: QueryClient, text: string): string | undefined {
  const sections = queryClient.getQueryData<{ sections: ShoppingSection[] }>(SECTIONS_KEY)?.sections
  if (!sections) return undefined
  const name = guessSection(text)
  return (
    sections.find((section) => sameSectionName(section.name, name)) ?? catchAllSection(sections)
  )?.id
}

export function useAddShoppingItem() {
  return useEinkaufAuftrag((input: CreateShoppingItemInput, queryClient) => ({
    art: 'einkauf.neu',
    id: crypto.randomUUID(),
    text: input.text,
    abteilung: input.sectionId ?? vermuteteAbteilung(queryClient, input.text),
    von: ich(queryClient),
  }))
}

export function useUpdateShoppingItem() {
  return useEinkaufAuftrag(
    ({ id, changes }: { id: string; changes: UpdateShoppingItemInput }, queryClient) => ({
      art: 'einkauf.aendern',
      id,
      changes,
      von: ich(queryClient),
    }),
  )
}

export function useDeleteShoppingItem() {
  return useEinkaufAuftrag((id: string) => ({ art: 'einkauf.loeschen', id }))
}

/**
 * „Aufräumen" – mit den Kennungen dessen, was hier erledigt dasteht. Was die
 * andere Person inzwischen abgehakt hat, bleibt stehen, auch wenn der Auftrag
 * erst nach dem Funkloch ankommt (siehe `clearDoneShoppingSchema`).
 */
export function useClearDoneShoppingItems() {
  return useEinkaufAuftrag((_: undefined, queryClient) => {
    const items = queryClient.getQueryData<{ items: ShoppingItem[] }>(SHOPPING_KEY)?.items ?? []
    const ids = items.filter((item) => item.done).map((item) => item.id)
    return ids.length > 0 ? { art: 'einkauf.aufraeumen', ids } : null
  })
}

/**
 * Gelöschte Einträge zurück – sofort sichtbar, so wie sie dastanden. Was die
 * Liste schon kennt, kommt nicht doppelt.
 */
export function useRestoreShoppingItems() {
  return useEinkaufAuftrag((items: ShoppingItem[]) => ({ art: 'einkauf.zurueck', items }))
}

/**
 * Die Abteilungen des Ladens.
 *
 * Ohne wiederkehrendes Nachfragen: Einträge kommen im Minutentakt dazu,
 * Abteilungen ein paarmal im Jahr. Nach jeder eigenen Änderung wird die Liste
 * ohnehin frisch geholt; die Minute Schonfrist deckt den Fall ab, dass die
 * andere Person gerade eine angelegt hat – beim nächsten Öffnen der App ist
 * sie da.
 */
export function useShoppingSections() {
  return useQuery({
    queryKey: SECTIONS_KEY,
    queryFn: api.listShoppingSections,
    staleTime: 60_000,
  })
}

/**
 * Änderungen an den Abteilungen.
 *
 * Auch die Einkaufsliste wird neu geholt: Wer eine Abteilung löscht,
 * verschiebt damit die Einträge, die darin lagen.
 */
function useSectionMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SECTIONS_KEY })
      void queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

export function useAddShoppingSection() {
  return useSectionMutation((name: string) => api.addShoppingSection({ name }))
}

export function useRenameShoppingSection() {
  return useSectionMutation(({ id, name }: { id: string; name: string }) =>
    api.renameShoppingSection(id, { name }),
  )
}

export function useDeleteShoppingSection() {
  return useSectionMutation((id: string) => api.deleteShoppingSection(id))
}

/**
 * Die neue Reihenfolge – sofort sichtbar, auch bevor der Server geantwortet
 * hat. Wer zweimal auf denselben Pfeil tippt, soll die Abteilung zwei Plätze
 * weiter oben sehen und nicht auf zwei Antworten warten.
 */
export function useReorderShoppingSections() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => api.reorderShoppingSections(ids),
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: SECTIONS_KEY })
      const previous = queryClient.getQueryData<{ sections: ShoppingSection[] }>(SECTIONS_KEY)

      if (previous) {
        const nach = new Map(previous.sections.map((section) => [section.id, section]))
        const sortiert = ids
          .map((id) => nach.get(id))
          .filter((section): section is ShoppingSection => section !== undefined)
        queryClient.setQueryData(SECTIONS_KEY, { sections: sortiert })
      }
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(SECTIONS_KEY, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SECTIONS_KEY })
    },
  })
}

const NOTES_KEY = 'notes'

/**
 * Wonach eine Notizliste gefragt wird.
 *
 * Der Haushalt fragt nur nach dem Suchbegriff; die DocBase zusätzlich nach der
 * Kategorie, weil ihre Notizen zwischen den Dokumenten stehen und demselben
 * Filter folgen müssen wie sie.
 */
export type NoteFilters = NotizFilter

function noteQueryString(filters: NoteFilters): string {
  const params = new URLSearchParams()
  if (filters.bereich) params.set('bereich', filters.bereich)
  if (filters.q) params.set('q', filters.q)
  if (filters.categoryId && filters.categoryId.length > 0) {
    params.set('categoryId', filters.categoryId.join(','))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * `enabled` ist – wie bei den Dokumenten – für die zweite, ungefilterte
 * Abfrage da: Sie läuft erst, wenn die gefilterte Liste leer bleibt.
 */
export function useNotes(filters: NoteFilters, enabled = true) {
  return useQuery({
    queryKey: [NOTES_KEY, filters],
    queryFn: async () => {
      const { notes } = await api.listNotes(noteQueryString(filters))
      return { notes: notizenMit(notes, offeneAuftraege(), filters) }
    },
    enabled,
    placeholderData: (previous) => previous,
  })
}

/** Alle Notizlisten im Zwischenspeicher, samt ihren Filtern. */
function notizlisten(queryClient: QueryClient) {
  return queryClient.getQueriesData<{ notes: Note[] }>({ queryKey: [NOTES_KEY] })
}

/** Einen eben eingereihten Auftrag in jeder Notizliste zeigen. */
function notizenZeigen(queryClient: QueryClient, auftrag: Auftrag): void {
  for (const [key, data] of notizlisten(queryClient)) {
    if (!data) continue
    const filters = (key[1] ?? {}) as NoteFilters
    queryClient.setQueryData(key, { ...data, notes: notizenMit(data.notes, [auftrag], filters) })
  }
}

/** Die Notiz, wie sie gerade in irgendeiner Liste steht – für das, was zurückkommt. */
function notizImZwischenspeicher(queryClient: QueryClient, id: string): Note | undefined {
  for (const [, data] of notizlisten(queryClient)) {
    const treffer = data?.notes.find((note) => note.id === id)
    if (treffer) return treffer
  }
  return undefined
}

/**
 * Was zuletzt gelöscht wurde – damit „Rückgängig" die Notiz sofort wieder
 * zeigen kann, auch wenn der Server noch gar nichts davon weiss.
 */
const zuletztGeloescht = new Map<string, Note>()

/**
 * Eine Notiz speichern. Eine neue bekommt ihre Kennung hier auf dem Gerät –
 * das Fenster schreibt danach unter derselben Kennung weiter, ob der Server
 * die Notiz schon kennt oder nicht.
 *
 * Zurück kommt die Notiz, wie sie jetzt dasteht – sofort, auch ohne
 * Verbindung. Gespeichert ist sie damit auf dem Gerät; zum Server geht sie
 * mit der Warteschlange.
 */
export function useSaveNote() {
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, note }: { id?: string; note: UpsertNoteInput }) => {
      await queryClient.cancelQueries({ queryKey: [NOTES_KEY] })
      const bisher = id ? notizImZwischenspeicher(queryClient, id) : undefined
      const auftrag = einreihen({
        art: 'notiz.speichern',
        id: id ?? crypto.randomUUID(),
        neu: !id,
        note: { ...note, id: undefined },
        von: ich(queryClient),
      })
      notizenZeigen(queryClient, auftrag)
      if (auftrag.art !== 'notiz.speichern') throw new Error('Unerwarteter Auftrag')
      return { note: notizNach(auftrag, bisher) }
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: [NOTES_KEY] })
      const bisher = notizImZwischenspeicher(queryClient, id)
      if (bisher) zuletztGeloescht.set(id, bisher)
      notizenZeigen(queryClient, einreihen({ art: 'notiz.loeschen', id }))
    },
  })
}

/** „Rückgängig" nach dem Löschen – der Server hält die Notiz 30 Tage bereit. */
export function useRestoreNote() {
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: [NOTES_KEY] })
      const notiz = zuletztGeloescht.get(id)
      zuletztGeloescht.delete(id)
      notizenZeigen(queryClient, einreihen({ art: 'notiz.zurueck', id, notiz }))
    },
  })
}

/**
 * Die eigene Reihenfolge – sofort sichtbar, auch bevor der Server geantwortet
 * hat. Gerechnet wird wie dort (`placeInOrder`), in jeder Liste dieses
 * Bereichs, die gerade im Zwischenspeicher liegt: Die ungefilterte Übersicht
 * soll nach dem Verschieben in einer Suche nicht den alten Stand zeigen.
 */
export function useReorderNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: ReorderNotesInput) => {
      await queryClient.cancelQueries({ queryKey: [NOTES_KEY] })
      notizenZeigen(
        queryClient,
        einreihen({ art: 'notiz.reihenfolge', bereich: input.bereich, ids: input.ids }),
      )
    },
  })
}

/**
 * Die wartenden Änderungen auf den aufbewahrten Stand legen – beim Start.
 *
 * Der Stand vom Gerät kann ein paar Augenblicke älter sein als die
 * Warteschlange: Wer offline etwas abhakt und die App gleich danach
 * schliesst, hat den Auftrag schon gesichert, die Liste vielleicht noch
 * nicht. Ohne Verbindung holt niemand eine neue – also hier.
 *
 * Der Zeitpunkt der Daten bleibt dabei, wie er war: Sonst gälten sie als
 * frisch, und mit Verbindung würde eine halbe Minute lang nicht nachgefragt.
 */
export function wartendeAnwenden(queryClient: QueryClient): void {
  const auftraege = offeneAuftraege()
  if (auftraege.length === 0) return
  const einkauf = queryClient.getQueryState<{ items: ShoppingItem[] }>(SHOPPING_KEY)
  if (einkauf?.data) {
    queryClient.setQueryData(
      SHOPPING_KEY,
      { items: einkaufMit(einkauf.data.items, auftraege) },
      { updatedAt: einkauf.dataUpdatedAt },
    )
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [NOTES_KEY] })) {
    const data = query.state.data as { notes: Note[] } | undefined
    if (!data) continue
    const filters = (query.queryKey[1] ?? {}) as NoteFilters
    queryClient.setQueryData(
      query.queryKey,
      { ...data, notes: notizenMit(data.notes, auftraege, filters) },
      { updatedAt: query.state.dataUpdatedAt },
    )
  }
}

export type { Bereich, Note, ShoppingItem, ShoppingSection }
