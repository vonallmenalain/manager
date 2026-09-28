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
 * Wie viel eines Textes unlesbar sein darf – Zeichen aus dem privaten
 * Unicode-Bereich oder Steuerzeichen –, bevor er als unbrauchbar gilt.
 *
 * Manche Rechnungen – die der Energie- und Wasserversorgung etwa – betten
 * Schriften ein, die ihre Zeichen auf U+E000 aufwärts abbilden. `pdftotext`
 * gibt das brav so aus: seitenweise Zeichen, die kein Mensch und keine Suche
 * lesen kann. Ohne diese Prüfung sähe das nach „genug Text" aus, und im
 * Suchindex stünde Buchstabensalat.
 */
export const MAX_UNREADABLE_SHARE = 0.2

/**
 * Steuerzeichen – ausser Tabulator, Umbruch und Seitenvorschub steht keines in
 * echtem Text. Der eigene PDF-Leser liefert sie, wenn eine Schrift zwei Bytes
 * je Zeichen braucht, wie in jedem PDF, das ein Browser druckt: Aus
 * „Rechnung" wird „\0R\0e\0c…", jedes zweite Zeichen ein Nullzeichen.
 */
export const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f]/g

function isControl(code: number): boolean {
  return code <= 8 || (code >= 14 && code <= 31) || code === 127
}

/**
 * Anteil der Zeichen, die nie echter Text sind: aus dem privaten Bereich oder
 * Steuerzeichen.
 */
export function unreadableShare(text: string): number {
  let unlesbar = 0
  let gesamt = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // Leerzeichen und Umbrüche sagen nichts über die Lesbarkeit aus.
    if (code <= 32 && !isControl(code)) continue
    gesamt += 1
    if (isControl(code) || (code >= 0xe000 && code <= 0xf8ff)) unlesbar += 1
  }
  return gesamt === 0 ? 0 : unlesbar / gesamt
}

/**
 * Ob eine gelesene Textebene brauchbar ist: lang genug und lesbar.
 *
 * Beides zusammen, denn beides allein täuscht. Ein paar Zeichen Kopfzeile
 * sind zu wenig, um ein Dokument auffindbar zu machen; zweitausend Zeichen aus
 * dem privaten Unicode-Bereich sind lang genug und trotzdem wertlos – genau wie
 * ein Text, in dem jedes zweite Zeichen ein Nullzeichen ist.
 */
export function isUsableTextLayer(text: string): boolean {
  return text.trim().length >= MIN_TEXT_LAYER_CHARS && unreadableShare(text) <= MAX_UNREADABLE_SHARE
}
