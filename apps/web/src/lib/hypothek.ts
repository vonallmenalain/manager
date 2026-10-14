import type {
  AmortizationInput,
  HypothekDaten,
  HypothekImportInput,
  LoanInput,
  MortgageSettings,
  SaveQuarterInput,
} from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

const KEY = ['hypothek'] as const

export function useHypothek() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.getHypothek(),
  })
}

/**
 * Jede Änderung liefert die ganze Hypothek zurück – wie bei den Rechnungen.
 * Prognose, Jahressummen und Amortisationsstand hängen an allem zugleich; eine
 * einzelne Zeile nachzuführen hiesse, jede dieser Zahlen von Hand mitzuziehen.
 */
function useHypothekMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<HypothekDaten>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data)
    },
  })
}

export function useSaveGrunddaten() {
  return useHypothekMutation((settings: MortgageSettings) => api.saveHypothekGrunddaten(settings))
}

export function useSaveVertrag() {
  return useHypothekMutation(({ id, loan }: { id: string | null; loan: LoanInput }) =>
    id === null ? api.addHypothekVertrag(loan) : api.updateHypothekVertrag(id, loan),
  )
}

export function useDeleteVertrag() {
  return useHypothekMutation((id: string) => api.deleteHypothekVertrag(id))
}

export function useSaveQuartal() {
  return useHypothekMutation(
    ({ year, quarter, input }: { year: number; quarter: number; input: SaveQuarterInput }) =>
      api.saveHypothekQuartal(year, quarter, input),
  )
}

export function useSaveTranche() {
  return useHypothekMutation(({ id, input }: { id: string | null; input: AmortizationInput }) =>
    id === null ? api.addAmortisation(input) : api.updateAmortisation(id, input),
  )
}

export function useDeleteTranche() {
  return useHypothekMutation((id: string) => api.deleteAmortisation(id))
}

/** Liest eine Excel-Tabelle aus – ändert nichts, deshalb ohne Aktualisierung. */
export function useImportHypothekExcel() {
  return useMutation({ mutationFn: (file: File) => api.importHypothekExcel(file) })
}

export function useUebernehmeHypothek() {
  return useHypothekMutation((daten: HypothekImportInput) => api.uebernehmeHypothek(daten))
}
