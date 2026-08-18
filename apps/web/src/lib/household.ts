import type {
  Bereich,
  CreateShoppingItemInput,
  Note,
  ShoppingItem,
  ShoppingSection,
  UpdateShoppingItemInput,
  UpsertNoteInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

const SHOPPING_KEY = ['shopping'] as const
const SECTIONS_KEY = ['shopping-sections'] as const

export function useShoppingList() {
  return useQuery({
    queryKey: SHOPPING_KEY,
    queryFn: api.listShopping,
    // Die Liste ist zu zweit in Bewegung: Wer im Laden steht, soll sehen,
    // wenn zuhause noch etwas dazukommt.
    refetchInterval: 20_000,
  })
}

/**
 * Setzt die Änderung sofort in der Liste um und macht sie bei einem Fehler
 * wieder rückgängig.
 *
 * Im Laden zählt das mehr als anderswo: Man tippt im Gehen, oft mit einem
 * Balken Empfang. Eine halbe Sekunde Verzögerung pro Häkchen fühlt sich an,
 * als hätte die App den Tipp verschluckt – und man tippt nochmals.
 */
function useOptimisticShopping<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  apply: (items: ShoppingItem[], variables: TVariables) => ShoppingItem[],
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })
      const previous = queryClient.getQueryData<{ items: ShoppingItem[] }>(SHOPPING_KEY)

      if (previous) {
        queryClient.setQueryData(SHOPPING_KEY, { items: apply(previous.items, variables) })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      // Zurück auf den Stand vor dem Tippen – sonst zeigt die Liste etwas an,
      // das der Server nie erfahren hat.
      if (context?.previous) queryClient.setQueryData(SHOPPING_KEY, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

export function useAddShoppingItem() {
  return useOptimisticShopping(
    (input: CreateShoppingItemInput) => api.addShoppingItem(input),
    (items, input) => [
      ...items,
      {
        // Vorläufiger Eintrag, bis der Server antwortet. Welche Abteilung es
        // wird, weiss nur er – er kennt das Gedächtnis der Liste. Bis dahin
        // steht der Eintrag ohne Abteilung, und die Liste zeigt ihn zuunterst.
        id: `vorlaeufig-${Date.now()}`,
        text: input.text,
        sectionId: input.sectionId ?? '',
        done: false,
        createdBy: '',
        doneBy: null,
        createdAt: new Date().toISOString(),
        doneAt: null,
      },
    ],
  )
}

export function useUpdateShoppingItem() {
  return useOptimisticShopping(
    ({ id, changes }: { id: string; changes: UpdateShoppingItemInput }) =>
      api.updateShoppingItem(id, changes),
    (items, { id, changes }) =>
      items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
  )
}

export function useDeleteShoppingItem() {
  return useOptimisticShopping(
    (id: string) => api.deleteShoppingItem(id),
    (items, id) => items.filter((item) => item.id !== id),
  )
}

export function useClearDoneShoppingItems() {
  return useOptimisticShopping(
    () => api.clearDoneShoppingItems(),
    (items) => items.filter((item) => !item.done),
  )
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
export interface NoteFilters {
  bereich?: Bereich
  q?: string
  categoryId?: string[]
}

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
    queryFn: () => api.listNotes(noteQueryString(filters)),
    enabled,
    placeholderData: (previous) => previous,
  })
}

export function useSaveNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id?: string; note: UpsertNoteInput }) =>
      id ? api.updateNote(id, note) : api.createNote(note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [NOTES_KEY] })
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [NOTES_KEY] })
    },
  })
}

export type { Note, ShoppingItem, ShoppingSection }
