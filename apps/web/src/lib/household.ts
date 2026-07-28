import type {
  CreateShoppingItemInput,
  Note,
  ShoppingItem,
  UpdateShoppingItemInput,
  UpsertNoteInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

const SHOPPING_KEY = ['shopping'] as const

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
        // Vorläufiger Eintrag, bis der Server antwortet. Die Abteilung kennt
        // nur er – bis dahin steht der Eintrag unter 'Sonstiges'.
        id: `vorlaeufig-${Date.now()}`,
        text: input.text,
        section: input.section ?? 'Sonstiges',
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

const NOTES_KEY = 'notes'

export function useNotes(search: string) {
  return useQuery({
    queryKey: [NOTES_KEY, search],
    queryFn: () => api.listNotes(search),
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

export type { Note, ShoppingItem }
