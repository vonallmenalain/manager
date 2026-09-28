import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

/**
 * Text aus Office-Dateien, RTF und Klartext – ohne LibreOffice.
 *
 * Word, Excel und PowerPoint (seit 2007) und das offene Format von
 * LibreOffice sind ZIP-Archive voller XML. Der Text steht darin im Klartext;
 * man muss nur die richtigen Teile auspacken und die Auszeichnung entfernen.
 * Dafür genügt das zlib von Node. Ein LibreOffice im Image wären mehrere
 * hundert Megabyte, die bei jedem Update über die Hausleitung müssten – für
 * einen Text, den die Suche nur braucht, um Wörter zu finden.
 *
 * Die alten Binärformate (.doc, .xls, .ppt) gehen so nicht. Sie werden
 * abgelegt und lassen sich öffnen, nur durchsucht werden sie nicht.
 */

/** Mehr Text braucht die Suche nicht – und die Datenbank soll nicht aufquellen. */
export const MAX_TEXT_CHARS = 200_000

/** Höchstens so viel entpackt ein einzelner Teil – gegen präparierte Archive. */
const MAX_TEIL_BYTES = 30 * 1024 * 1024
/** Und so viel alle Teile einer Datei zusammen: tausend Folien à 30 MB wären Minuten Arbeit. */
const MAX_GESAMT_BYTES = 100 * 1024 * 1024
const MAX_EINTRAEGE = 10_000

export type OfficeArt = 'word' | 'excel' | 'powerpoint' | 'opendocument'

const OFFICE_ARTEN: Record<string, OfficeArt> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/vnd.oasis.opendocument.text': 'opendocument',
  'application/vnd.oasis.opendocument.spreadsheet': 'opendocument',
  'application/vnd.oasis.opendocument.presentation': 'opendocument',
}

/** Die Office-Dateien, deren Text sich aus dem ZIP lesen lässt. */
export function officeArt(mimeType: string): OfficeArt | null {
  return OFFICE_ARTEN[mimeType] ?? null
}

/** Die alten Binärformate – abgelegt ja, gelesen nein. */
export const ALTE_OFFICE_TYPEN: ReadonlySet<string> = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
])

/**
 * Aus dieser Art Datei lässt sich grundsätzlich kein Text lesen – kein Fehler,
 * der beim nächsten Versuch verschwindet. Die Datei bleibt abgelegt und lässt
 * sich öffnen; nur durchsuchen lässt sie sich nicht.
 */
export class KeinTextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeinTextError'
  }
}

function begrenzt(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
}

/**
 * Der Text einer Datei, die ihn in sich trägt: Office, LibreOffice, RTF,
 * Klartext. `null` für alles andere – ein PDF oder Bild geht an die
 * Texterkennung.
 */
export async function eingebetteterText(
  absolutePath: string,
  mimeType: string,
): Promise<string | null> {
  const art = officeArt(mimeType)
  if (art) return begrenzt(officeText(await readFile(absolutePath), art))

  if (mimeType === 'application/rtf') {
    // RTF selbst ist reines ASCII; Umlaute stehen darin als Steuerzeichen.
    return begrenzt(rtfText((await readFile(absolutePath)).toString('latin1')))
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return begrenzt(klartext(await readFile(absolutePath)))
  }
  if (ALTE_OFFICE_TYPEN.has(mimeType)) {
    throw new KeinTextError(
      'Aus alten Word-, Excel- und PowerPoint-Dateien (.doc, .xls, .ppt) lässt sich kein Text lesen.',
    )
  }
  return null
}

// --------------------------------------------------------------------- ZIP

interface ZipEintrag {
  name: string
  flags: number
  methode: number
  komprimiert: number
  entpackt: number
  offset: number
}

/**
 * Das Inhaltsverzeichnis eines ZIP-Archivs.
 *
 * Gelesen wird das zentrale Verzeichnis am Ende, nicht die Kopfzeilen der
 * Einträge: Nur dort stehen die Grössen verlässlich, auch wenn ein Programm
 * sie erst nach den Daten geschrieben hat.
 */
function zipEintraege(zip: Buffer): ZipEintrag[] {
  // Das Ende des Verzeichnisses: 22 Byte, dahinter höchstens ein Kommentar.
  const untergrenze = Math.max(0, zip.length - 22 - 0xffff)
  let ende = -1
  for (let pos = zip.length - 22; pos >= untergrenze; pos--) {
    if (zip.readUInt32LE(pos) === 0x06054b50) {
      ende = pos
      break
    }
  }
  if (ende < 0) throw new Error('Kein ZIP-Archiv')

  const anzahl = zip.readUInt16LE(ende + 10)
  let pos = zip.readUInt32LE(ende + 16)
  const eintraege: ZipEintrag[] = []
  for (let nummer = 0; nummer < anzahl && nummer < MAX_EINTRAEGE; nummer++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('ZIP-Verzeichnis beschädigt')
    }
    const nameLaenge = zip.readUInt16LE(pos + 28)
    eintraege.push({
      name: zip.toString('utf8', pos + 46, pos + 46 + nameLaenge),
      flags: zip.readUInt16LE(pos + 8),
      methode: zip.readUInt16LE(pos + 10),
      komprimiert: zip.readUInt32LE(pos + 20),
      entpackt: zip.readUInt32LE(pos + 24),
      offset: zip.readUInt32LE(pos + 42),
    })
    pos += 46 + nameLaenge + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32)
  }
  return eintraege
}

/** Ein einzelner Teil, entpackt – begrenzt, damit kein Archiv den Speicher füllt. */
function zipTeil(zip: Buffer, eintrag: ZipEintrag): Buffer {
  if (eintrag.flags & 1) throw new Error('Verschlüsselte Datei')
  if (eintrag.entpackt > MAX_TEIL_BYTES) throw new Error('Teil der Datei zu gross')

  const kopf = eintrag.offset
  if (kopf + 30 > zip.length || zip.readUInt32LE(kopf) !== 0x04034b50) {
    throw new Error('ZIP-Eintrag beschädigt')
  }
  const start = kopf + 30 + zip.readUInt16LE(kopf + 26) + zip.readUInt16LE(kopf + 28)
  const daten = zip.subarray(start, start + eintrag.komprimiert)

  if (eintrag.methode === 0) return daten
  if (eintrag.methode === 8) return inflateRawSync(daten, { maxOutputLength: MAX_TEIL_BYTES })
  throw new Error(`Unbekannte Kompression (${eintrag.methode})`)
}

// --------------------------------------------------------------------- XML

const BENANNTE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function entitaeten(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, code: string) => {
    if (code.startsWith('#')) {
      const zahl = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return zahl > 0 && zahl <= 0x10ffff ? String.fromCodePoint(zahl) : ''
    }
    return BENANNTE[code.toLowerCase()] ?? ganz
  })
}

/** Die Auszeichnung weg, Entitäten aufgelöst – übrig bleibt der Text. */
function ohneTags(xml: string): string {
  return entitaeten(xml.replace(/<[^>]*>/g, ''))
}

/**
 * Nur der Inhalt der Textelemente – dazu Umbrüche an den Stellen, die das
 * Format dafür vorsieht.
 *
 * Bei Word, Excel und PowerPoint steht Text ausschliesslich in eigenen
 * Elementen (`<w:t>`, `<t>`, `<a:t>`). Alles dazwischen – auch Leerraum, mit
 * dem manche Programme das XML einrücken – gehört nicht dazu.
 */
function textElemente(
  xml: string,
  element: string,
  /** Weitere Stellen, die zu Zeichen werden: [Muster, Zeichen]. */
  zeichen: readonly (readonly [string, string])[],
): string {
  const muster = new RegExp(
    [
      `<${element}(?:\\s[^>]*)?>([\\s\\S]*?)</${element}>`,
      ...zeichen.map(([quelle]) => `(${quelle})`),
    ].join('|'),
    'g',
  )
  let text = ''
  for (const treffer of xml.matchAll(muster)) {
    if (treffer[1] !== undefined) {
      text += entitaeten(treffer[1])
      continue
    }
    const nummer = treffer.slice(2).findIndex((gruppe) => gruppe !== undefined)
    text += zeichen[nummer]?.[1] ?? ''
  }
  return text
}

/**
 * Word: Absätze werden zu Zeilen. Feldbefehle („PAGE \* MERGEFORMAT") und
 * gelöschter Text der Änderungsverfolgung stehen in eigenen Elementen und
 * bleiben so ohnehin draussen; die Ersatzfassung von Textfeldern (derselbe
 * Text ein zweites Mal) wird vorher entfernt.
 */
function wordText(xml: string): string {
  return textElemente(xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, ''), 'w:t', [
    // Ohne Attribute: <w:tab w:val="left" …/> ist ein Tabstopp, kein Tabulator.
    ['<w:tab/>', '\t'],
    ['<w:(?:br|cr)\\b[^>]*/>', '\n'],
    ['</w:p>', '\n'],
  ])
}

/** Excel: die Texte der Zellen, je einer pro Zeile – Zahlen findet die Suche ohnehin selten. */
function excelText(xml: string): string {
  // Lesehilfen für japanische Schrift (<rPh>) wiederholen den Text in Lautschrift.
  return textElemente(xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), 't', [['</si>', '\n']])
}

/**
 * Texte, die direkt in den Zellen eines Blatts stehen (`inlineStr`) statt in
 * der gemeinsamen Liste – so schreiben manche Programme ihre Tabellen, und
 * eine sharedStrings.xml gibt es dann gar nicht.
 */
function blattText(xml: string): string {
  const texte: string[] = []
  for (const treffer of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) {
    texte.push(excelText(treffer[1] ?? ''))
  }
  return texte.join('\n')
}

function folienText(xml: string): string {
  return textElemente(xml, 'a:t', [
    ['<a:br\\b[^>]*>', '\n'],
    ['</a:p>', '\n'],
  ])
}

/**
 * LibreOffice: Absätze, Überschriften und Tabellenzeilen werden zu Zeilen.
 *
 * Anders als bei Word steht der Text hier direkt in den Absätzen, zwischen
 * den Elementen für Hervorhebungen. Deshalb fällt die Auszeichnung weg statt
 * dass Textelemente gesammelt werden – vorher aber der Leerraum samt
 * Zeilenumbruch, mit dem manche Programme das XML einrücken.
 */
function openDocumentText(xml: string): string {
  return ohneTags(
    xml
      .replace(/>\s*\n\s*</g, '><')
      .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, '')
      .replace(/<text:tab\b[^>]*\/>/g, '\t')
      .replace(/<text:line-break\b[^>]*\/>/g, '\n')
      .replace(/<text:s\b([^>]*)\/>/g, (_ganz, attribute: string) =>
        ' '.repeat(Math.min(Number(/text:c="(\d+)"/.exec(attribute)?.[1] ?? 1), 100)),
      )
      .replace(/<\/table:table-cell>/g, '\t')
      .replace(/<\/(?:text:p|text:h|table:table-row)>/g, '\n'),
  )
}

/** Der Text einer Office-Datei aus dem ZIP. */
export function officeText(zip: Buffer, art: OfficeArt): string {
  const eintraege = zipEintraege(zip)
  let entpackt = 0
  const auspacken = (eintrag: ZipEintrag): string => {
    const daten = zipTeil(zip, eintrag)
    entpackt += daten.length
    if (entpackt > MAX_GESAMT_BYTES) throw new Error('Datei entpackt zu gross')
    return daten.toString('utf8')
  }
  const teil = (name: string): string | null => {
    const eintrag = eintraege.find((kandidat) => kandidat.name === name)
    return eintrag ? auspacken(eintrag) : null
  }

  switch (art) {
    case 'word': {
      const xml = teil('word/document.xml')
      if (xml === null) throw new Error('Kein Word-Dokument')
      return wordText(xml)
    }
    case 'excel': {
      // Die gemeinsame Liste der Zelltexte – fehlt, wenn keine Zelle Text hat
      // oder das Programm die Texte in die Blätter schreibt.
      const texte = [excelText(teil('xl/sharedStrings.xml') ?? '')]
      let laenge = texte[0]?.length ?? 0
      for (const eintrag of eintraege) {
        if (laenge > MAX_TEXT_CHARS) break
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(eintrag.name)) continue
        const text = blattText(auspacken(eintrag))
        texte.push(text)
        laenge += text.length
      }
      return texte.filter(Boolean).join('\n')
    }
    case 'powerpoint': {
      const folien = eintraege
        .map((eintrag) => ({
          eintrag,
          nummer: /^ppt\/slides\/slide(\d+)\.xml$/.exec(eintrag.name)?.[1],
        }))
        .filter(
          (folie): folie is { eintrag: ZipEintrag; nummer: string } => folie.nummer !== undefined,
        )
        .sort((a, b) => Number(a.nummer) - Number(b.nummer))
      const texte: string[] = []
      let laenge = 0
      for (const { eintrag } of folien) {
        const text = folienText(auspacken(eintrag))
        texte.push(text)
        laenge += text.length
        if (laenge > MAX_TEXT_CHARS) break
      }
      return texte.join('\n\n')
    }
    case 'opendocument': {
      const xml = teil('content.xml')
      if (xml === null) throw new Error('Kein OpenDocument')
      return openDocumentText(xml)
    }
  }
}

// --------------------------------------------------------------------- RTF

/** Gruppen ohne Fliesstext: Schriften, Farben, Vorlagen, Bilder, Kopf- und Fusszeilen. */
const RTF_OHNE_TEXT = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'generator',
])

const RTF_ZEICHEN: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  row: '\n',
  tab: '\t',
  cell: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
}

/**
 * Text aus RTF – dem Format von WordPad und TextEdit.
 *
 * RTF ist Text mit Steuerwörtern (\par, \b …) in geschweiften Klammern.
 * Übersprungen werden die Gruppen ohne Fliesstext und alles, was mit \*
 * beginnt. Sonderzeichen kommen als \'hh (Windows-1252) oder \uN, gefolgt
 * von einem Ersatzzeichen für Programme, die \u nicht kennen – das fällt weg.
 */
export function rtfText(rtf: string): string {
  const windows1252 = new TextDecoder('windows-1252')
  let text = ''
  let tiefe = 0
  /** Ab dieser Tiefe wird übersprungen; -1: nichts überspringen. */
  let ohneTextAb = -1
  let ersatzLaenge = 1
  const ersatzStapel: number[] = []
  let nochAuslassen = 0

  for (let pos = 0; pos < rtf.length; pos++) {
    const zeichen = rtf[pos] as string

    if (zeichen === '{') {
      tiefe += 1
      ersatzStapel.push(ersatzLaenge)
      continue
    }
    if (zeichen === '}') {
      if (ohneTextAb === tiefe) ohneTextAb = -1
      tiefe -= 1
      ersatzLaenge = ersatzStapel.pop() ?? 1
      continue
    }
    const ueberspringen = ohneTextAb !== -1

    if (zeichen === '\\') {
      const naechstes = rtf[pos + 1]
      if (naechstes === undefined) break

      if (naechstes === '\\' || naechstes === '{' || naechstes === '}') {
        if (!ueberspringen) text += naechstes
        pos += 1
        continue
      }
      if (naechstes === "'") {
        const hex = rtf.slice(pos + 2, pos + 4)
        pos += 3
        if (nochAuslassen > 0) {
          nochAuslassen -= 1
          continue
        }
        if (!ueberspringen && /^[0-9a-f]{2}$/i.test(hex)) {
          text += windows1252.decode(Uint8Array.of(parseInt(hex, 16)))
        }
        continue
      }
      if (naechstes === '*') {
        if (ohneTextAb === -1) ohneTextAb = tiefe
        pos += 1
        continue
      }
      if (naechstes === '~') {
        if (!ueberspringen) text += ' '
        pos += 1
        continue
      }
      if (naechstes === '\n' || naechstes === '\r') {
        if (!ueberspringen) text += '\n'
        pos += 1
        continue
      }

      const steuerwort = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(pos + 1, pos + 40))
      if (!steuerwort) {
        // Ein anderes Steuerzeichen (\- \_ \|) – ohne Text.
        pos += 1
        continue
      }
      pos += steuerwort[0].length
      const wort = steuerwort[1] as string
      const zahl = steuerwort[2] === undefined ? undefined : Number(steuerwort[2])

      if (RTF_OHNE_TEXT.has(wort)) {
        if (ohneTextAb === -1) ohneTextAb = tiefe
        continue
      }
      if (ueberspringen) continue
      if (wort === 'uc') {
        ersatzLaenge = zahl ?? 1
      } else if (wort === 'u' && zahl !== undefined) {
        text += String.fromCharCode(zahl < 0 ? zahl + 65536 : zahl)
        nochAuslassen = ersatzLaenge
      } else {
        text += RTF_ZEICHEN[wort] ?? ''
      }
      continue
    }

    // Zeilenumbrüche im Quelltext sind keine im Text.
    if (zeichen === '\n' || zeichen === '\r' || ueberspringen) continue
    if (nochAuslassen > 0) {
      nochAuslassen -= 1
      continue
    }
    text += zeichen
  }

  return text
}

// ---------------------------------------------------------------- Klartext

/**
 * Klartext in der Kodierung, in der er gespeichert ist: UTF-16 am
 * Byte-Order-Mark, sonst UTF-8 – und wo das nicht aufgeht, die Kodierung
 * älterer Windows-Programme, in der ein „ä" ein einzelnes Byte ist.
 */
export function klartext(daten: Buffer): string {
  if (daten[0] === 0xff && daten[1] === 0xfe) return new TextDecoder('utf-16le').decode(daten)
  if (daten[0] === 0xfe && daten[1] === 0xff) return new TextDecoder('utf-16be').decode(daten)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(daten)
  } catch {
    return new TextDecoder('windows-1252').decode(daten)
  }
}
