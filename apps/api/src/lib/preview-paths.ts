/**
 * Reine Logik der Seitenvorschau: das Auswerten der pdfinfo-Ausgabe und die
 * Ablageorte der gerasterten Seiten.
 *
 * Wie storage-paths.ts bewusst ohne jede Abhängigkeit – so lässt sich beides
 * prüfen, ohne dass poppler installiert oder eine Ablage konfiguriert sein
 * muss. Die Seiten, die tatsächlich Prozesse starten und Dateien schreiben,
 * stehen in preview.ts.
 */

/** Wie bei der Texterkennung: mehr Seiten braucht kein Haushaltsdokument. */
export const PREVIEW_MAX_PAGES = 25

/** Ordner der zwischengespeicherten Seiten, relativ zur Dokumentenablage. */
export const PREVIEW_DIR = '.previews'

/**
 * Liest die Seitenzahl aus der Ausgabe von `pdfinfo`.
 *
 * Die Ausgabe ist ein loses Schlüssel-Wert-Format, und ein passwortgeschütztes
 * PDF liefert sie ganz ohne Zeile "Pages" – dann gibt es eben keine Vorschau,
 * aber auch keinen Fehler.
 */
export function parsePageCount(stdout: string): number {
  for (const line of stdout.split('\n')) {
    const match = /^Pages:\s+(\d+)$/.exec(line.trim())
    if (match?.[1]) {
      const pages = Number(match[1])
      if (Number.isInteger(pages) && pages > 0) return pages
    }
  }
  return 0
}

/**
 * Ablageort einer gerasterten Seite, relativ zur Dokumentenablage.
 *
 * Die Seitennummer wird hier auf eine ganze Zahl im gültigen Bereich
 * festgenagelt: Sie stammt aus der Adresszeile und landet in einem
 * Dateinamen – der Weg dazwischen darf nichts anderes durchlassen.
 */
export function previewPagePath(documentId: string, page: number): string {
  if (!Number.isInteger(page) || page < 1 || page > PREVIEW_MAX_PAGES) {
    throw new Error(`Ungültige Seitennummer: ${page}`)
  }
  return `${PREVIEW_DIR}/${documentId}/s${page}.jpg`
}
