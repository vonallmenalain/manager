import type { BillInput } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type HausBills } from './api'

const KEY = 'haus'

export function useHausBills() {
  return useQuery({
    queryKey: [KEY],
    queryFn: () => api.listHausBills(),
  })
}

/**
 * Jede Änderung liefert die ganze Liste zurück.
 *
 * Der Bildschirm zeigt Summen, Trends und Diagramme über alle Rechnungen –
 * eine einzelne geänderte Zeile nachzupflegen hiesse, jede dieser Zahlen von
 * Hand mitzuziehen. Die Liste ist kurz genug, dass das Ganze zu holen billiger
 * ist als der Fehler, den man sich dabei einhandelt.
 */
function useBillMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<HausBills>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([KEY], data)
    },
  })
}

/** Liest ein PDF aus – ändert nichts, deshalb ohne Aktualisierung der Liste. */
export function useImportHausBill() {
  return useMutation({ mutationFn: (file: File) => api.importHausBill(file) })
}

/**
 * Übernimmt eine Rechnung. Kommt die Datei mit, wird sie zugleich in den
 * Dokumenten abgelegt – deshalb wird auch deren Liste ungültig.
 */
export function useAddHausBill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      bill,
      file,
      categoryId,
    }: {
      bill: BillInput
      file?: File | null
      categoryId?: string | null
    }) => api.addHausBill(bill, file, categoryId),
    onSuccess: (data) => {
      queryClient.setQueryData([KEY], data)
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useUpdateHausBill() {
  return useBillMutation(({ id, bill }: { id: string; bill: BillInput }) =>
    api.updateHausBill(id, bill),
  )
}

export function useDeleteHausBill() {
  return useBillMutation((id: string) => api.deleteHausBill(id))
}
