import type { BillInput } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type StromBills } from './api'

const KEY = 'strom'

export function useStromBills() {
  return useQuery({
    queryKey: [KEY],
    queryFn: () => api.listStromBills(),
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
function useBillMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<StromBills>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([KEY], data)
    },
  })
}

/** Liest ein PDF aus – ändert nichts, deshalb ohne Aktualisierung der Liste. */
export function useImportStromBill() {
  return useMutation({ mutationFn: (file: File) => api.importStromBill(file) })
}

export function useAddStromBill() {
  return useBillMutation((bill: BillInput) => api.addStromBill(bill))
}

export function useUpdateStromBill() {
  return useBillMutation(({ id, bill }: { id: string; bill: BillInput }) =>
    api.updateStromBill(id, bill),
  )
}

export function useDeleteStromBill() {
  return useBillMutation((id: string) => api.deleteStromBill(id))
}
