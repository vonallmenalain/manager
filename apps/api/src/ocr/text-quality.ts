/**
 * Ob ein gelesener Text taugt – oder ob es sich lohnt, es anders zu versuchen.
 *
 * Steht bewusst allein und ohne Einbindungen: So lässt sich die Regel prüfen,
 * ohne dass ein Test die halbe Erkennungskette samt ihrer Werkzeuge mitbringen
 * müsste.
 */

/**
 * Ab wie vielen Zeichen eine vorhandene Textebene als brauchbar gilt.
 *
 * Gescannte PDFs enthalten oft ein paar Zeichen Kopfzeile oder Metadaten,
 * ohne dass der Inhalt lesbar wäre. Zu niedrig angesetzt, würde die
 * Texterkennung übersprungen und das Dokument bliebe unauffindbar.
 */
export const MIN_TEXT_LAYER_CHARS = 120

/**
 * Wie viel eines Textes aus dem privaten Unicode-Bereich stammen darf, bevor
 * er als unbrauchbar gilt.
 *
 * Manche Rechnungen – die der Energie- und Wasserversorgung etwa – betten
 * Schriften ein, die ihre Zeichen auf U+E000 aufwärts abbilden. `pdftotext`
 * gibt das brav so aus: seitenweise Zeichen, die kein Mensch und keine Suche
 * lesen kann. Ohne diese Prüfung sähe das nach „genug Text" aus, und im
 * Suchindex stünde Buchstabensalat.
 */
export const MAX_PRIVATE_USE_SHARE = 0.2

/** Anteil der Zeichen aus dem privaten Bereich – dort steht nie echter Text. */
export function privateUseShare(text: string): number {
  let privat = 0
  let gesamt = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // Leerzeichen und Umbrüche sagen nichts über die Lesbarkeit aus.
    if (code <= 32) continue
    gesamt += 1
    if (code >= 0xe000 && code <= 0xf8ff) privat += 1
  }
  return gesamt === 0 ? 0 : privat / gesamt
}

/**
 * Ob eine gelesene Textebene brauchbar ist: lang genug und lesbar.
 *
 * Beides zusammen, denn beides allein täuscht. Ein paar Zeichen Kopfzeile
 * sind zu wenig, um ein Dokument auffindbar zu machen; zweitausend Zeichen aus
 * dem privaten Unicode-Bereich sind lang genug und trotzdem wertlos.
 */
export function isUsableTextLayer(text: string): boolean {
  return (
    text.trim().length >= MIN_TEXT_LAYER_CHARS && privateUseShare(text) <= MAX_PRIVATE_USE_SHARE
  )
}
