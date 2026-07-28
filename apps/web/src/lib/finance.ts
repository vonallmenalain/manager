import type { CreatePaymentInput, FinanceSettings, SaveMonthInput } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type FinanceYear } from './api'

const KEY = 'finanzen'

export function useFinanceYear(year: number) {
  return useQuery({
    queryKey: [KEY, year],
    queryFn: () => api.getFinanceYear(year),
  })
}

/**
 * Alle Änderungen liefern das ganze Jahr zurück – Einkommen, Zahlungen und
 * die gerechneten Zahlen hängen zusammen, und ein halb aktualisierter
 * Bildschirm wäre bei einer Abrechnung schlimmer als eine Zehntelsekunde
 * Wartezeit.
 */
function useFinanceMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<FinanceYear>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([KEY, data.year], data)
    },
  })
}

export function useSaveFinanceSettings(year: number) {
  return useFinanceMutation((settings: FinanceSettings) => api.saveFinanceSettings(year, settings))
}

export function useSaveFinanceMonth(year: number) {
  return useFinanceMutation(({ month, input }: { month: number; input: SaveMonthInput }) =>
    api.saveFinanceMonth(year, month, input),
  )
}

export function useAddPayment(year: number) {
  return useFinanceMutation((payment: CreatePaymentInput) => api.addPayment(year, payment))
}

export function useDeleteDonation(year: number) {
  return useFinanceMutation((id: string) => api.deleteDonation(year, id))
}
