/**
 * Liest den Datenstrom einer hochgeladenen Datei in den Speicher – für Dateien,
 * die nur ausgelesen und nicht abgelegt werden: eine Rechnung vor der
 * Vorschau, eine Excel-Tabelle der Hypothek.
 */
export async function readUpload(
  stream: AsyncIterable<Buffer>,
  limit: number,
): Promise<Buffer | 'zu-gross'> {
  const parts: Buffer[] = []
  let size = 0

  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) return 'zu-gross'
    parts.push(chunk)
  }

  return Buffer.concat(parts)
}
