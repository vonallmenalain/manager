import type { FastifyBaseLogger } from 'fastify'

import { OcrWorker } from './worker.js'

/**
 * Der eine Worker der Anwendung.
 *
 * Bewusst ein Modul-Zustand statt einer Übergabe durch alle Schichten: Die
 * Routen müssen ihn nur anstossen, nicht besitzen. Vor dem Start ist er null –
 * die Aufrufer nutzen deshalb `ocrWorker?.notify()`.
 */
export let ocrWorker: OcrWorker | null = null

export async function startOcrWorker(log: FastifyBaseLogger): Promise<OcrWorker> {
  const worker = new OcrWorker(log)
  ocrWorker = worker
  await worker.start()
  return worker
}

export async function stopOcrWorker(): Promise<void> {
  await ocrWorker?.stop()
  ocrWorker = null
}

export { OcrWorker }
