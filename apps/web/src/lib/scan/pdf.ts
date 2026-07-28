/**
 * Mehrere Seiten in einer PDF-Datei zusammenfassen.
 *
 * Von Hand geschrieben, und das aus einem guten Grund: Eine PDF-Bibliothek
 * bringt Schriften, Formulare und einen Parser mit – gebraucht wird davon
 * nichts. Hier entsteht immer dieselbe, denkbar einfache Datei: je Seite ein
 * JPEG, das die ganze Seite füllt. Die Bilddaten wandern dabei unverändert in
 * die Datei (Filter `DCTDecode`), es wird also nichts neu gerechnet und nichts
 * an Qualität verschenkt.
 *
 * Der Aufbau folgt dem PDF-Referenzhandbuch, Kapitel 7.5: Objekte
 * hintereinander, danach eine Tabelle mit ihren Byte-Positionen. Genau diese
 * Positionen sind der heikle Teil – stimmen sie nicht, öffnet die Datei bei
 * niemandem. Deshalb sind sie in pdf.test.ts geprüft.
 */

export interface JpegInfo {
  width: number
  height: number
  /** 1 = Graustufen, 3 = Farbe (YCbCr). */
  components: number
}

/**
 * Liest Grösse und Farbkanäle aus den Kopfdaten eines JPEG.
 *
 * Der Browser kennt die Grösse zwar auch, aber nur als Zahl neben der Datei.
 * Hier wird sie aus der Datei selbst gelesen – so kann keine Seite mit
 * vertauschten Massen im PDF landen.
 */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  const byte = (index: number): number => bytes[index] as number
  if (bytes.length < 4 || byte(0) !== 0xff || byte(1) !== 0xd8) return null

  let offset = 2

  while (offset + 1 < bytes.length) {
    if (byte(offset) !== 0xff) {
      offset += 1
      continue
    }

    let marker = byte(offset + 1)
    // Vor einem Markierer dürfen beliebig viele 0xFF stehen.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1
      marker = byte(offset + 1)
    }
    offset += 2

    // Markierer ohne Nutzlast.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    // Ab hier kommen die Bilddaten; ein Grössenblock wäre längst gekommen.
    if (marker === 0xda) return null

    if (offset + 1 >= bytes.length) return null
    const length = (byte(offset) << 8) | byte(offset + 1)
    if (length < 2) return null

    // SOF0 bis SOF15 tragen die Bildgrösse – ausser den drei Markierern in
    // diesem Bereich, die etwas ganz anderes bedeuten (Huffman-Tabellen,
    // arithmetische Kodierung, Erweiterung).
    const isSizeSegment =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

    if (isSizeSegment) {
      if (offset + 7 >= bytes.length) return null
      return {
        height: (byte(offset + 3) << 8) | byte(offset + 4),
        width: (byte(offset + 5) << 8) | byte(offset + 6),
        components: byte(offset + 7),
      }
    }

    offset += length
  }

  return null
}

/**
 * Längste Seitenkante in Punkten (1/72 Zoll) – die lange Kante von A4.
 *
 * Die Seite bekommt damit ungefähr das Format, das das Papier tatsächlich
 * hatte. Ohne diese Vorgabe ergäbe sich die Seitengrösse aus der Anzahl
 * Bildpunkte, und ein Scan wäre je nach Handykamera plötzlich plakatgross.
 */
const A4_LONG_EDGE = 841.89

const encoder = new TextEncoder()

/** Sammelt die Teile der Datei und merkt sich, wo jedes Objekt beginnt. */
class PdfWriter {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  get offset(): number {
    return this.length
  }

  write(part: string | Uint8Array): void {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    this.chunks.push(bytes)
    this.length += bytes.length
  }

  // Uint8Array<ArrayBuffer> statt nur Uint8Array: Erst mit dem festgelegten
  // Puffer nimmt File() die Bytes ohne Umweg entgegen.
  toBytes(): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(this.length)
    let position = 0
    for (const chunk of this.chunks) {
      result.set(chunk, position)
      position += chunk.length
    }
    return result
  }
}

function colorSpace(components: number): string {
  if (components === 1) return '/DeviceGray'
  if (components === 3) return '/DeviceRGB'
  throw new Error(`JPEG mit ${components} Farbkanälen wird nicht unterstützt.`)
}

/** Rundet auf zwei Stellen und schreibt die Zahl ohne Exponentialschreibweise. */
function points(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/**
 * Baut aus JPEG-Seiten eine PDF-Datei. Die Reihenfolge der Bilder ist die
 * Reihenfolge der Seiten.
 */
export function buildPdfFromJpegs(jpegs: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  if (jpegs.length === 0) throw new Error('Ohne Seiten lässt sich kein PDF bauen.')

  const pages = jpegs.map((jpeg) => {
    const info = readJpegInfo(jpeg)
    if (!info || info.width <= 0 || info.height <= 0) {
      throw new Error('Eine der Seiten liess sich nicht lesen.')
    }
    const scale = A4_LONG_EDGE / Math.max(info.width, info.height)
    return {
      jpeg,
      info,
      width: info.width * scale,
      height: info.height * scale,
    }
  })

  // Objekt 1 ist der Katalog, Objekt 2 die Seitenliste; danach je Seite drei
  // Objekte (Seite, Inhalt, Bild).
  const objectCount = 2 + pages.length * 3
  const offsets = new Array<number>(objectCount + 1).fill(0)
  const writer = new PdfWriter()

  const startObject = (number: number, dictionary: string): void => {
    offsets[number] = writer.offset
    writer.write(`${number} 0 obj\n${dictionary}\n`)
  }

  // Die zweite Zeile mit hohen Bytes markiert die Datei als binär – ohne sie
  // behandeln manche Übertragungswege sie als Text und zerstören die Bilder.
  writer.write('%PDF-1.4\n')
  writer.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  startObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
  writer.write('endobj\n')

  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
  startObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  writer.write('endobj\n')

  pages.forEach((page, index) => {
    const pageNumber = 3 + index * 3
    const contentNumber = pageNumber + 1
    const imageNumber = pageNumber + 2

    startObject(
      pageNumber,
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${points(page.width)} ${points(page.height)}] ` +
        `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> ` +
        `/Contents ${contentNumber} 0 R >>`,
    )
    writer.write('endobj\n')

    // Das Bild wird auf die volle Seitengrösse aufgezogen und gezeichnet.
    const content = `q\n${points(page.width)} 0 0 ${points(page.height)} 0 0 cm\n/Im0 Do\nQ\n`
    startObject(contentNumber, `<< /Length ${content.length} >>`)
    writer.write(`stream\n${content}endstream\n`)
    writer.write('endobj\n')

    startObject(
      imageNumber,
      `<< /Type /XObject /Subtype /Image ` +
        `/Width ${page.info.width} /Height ${page.info.height} ` +
        `/ColorSpace ${colorSpace(page.info.components)} /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${page.jpeg.length} >>`,
    )
    writer.write('stream\n')
    writer.write(page.jpeg)
    writer.write('\nendstream\n')
    writer.write('endobj\n')
  })

  const xrefOffset = writer.offset
  writer.write(`xref\n0 ${objectCount + 1}\n`)
  writer.write('0000000000 65535 f \n')
  for (let number = 1; number <= objectCount; number += 1) {
    // Jeder Eintrag ist exakt zwanzig Bytes lang – darauf verlassen sich die
    // Betrachter beim Springen in der Tabelle.
    writer.write(`${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`)
  }

  writer.write(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`)
  writer.write(`startxref\n${xrefOffset}\n%%EOF\n`)

  return writer.toBytes()
}
