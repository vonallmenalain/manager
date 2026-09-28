import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'

import {
  eingebetteterText,
  KeinTextError,
  klartext,
  MAX_TEXT_CHARS,
  officeArt,
  officeText,
  rtfText,
} from './office.ts'

/**
 * Ein ZIP-Archiv wie das von Word – klein, aber mit allem, was der Leser
 * auswerten muss: lokale Köpfe, zentrales Verzeichnis, gespeicherte und
 * gepackte Einträge.
 */
function zip(
  teile: Record<string, string>,
  {
    packen = true,
    entpacktAngabe,
  }: {
    packen?: boolean
    /** Eine falsche Angabe der entpackten Grösse – wie in einem präparierten Archiv. */
    entpacktAngabe?: number
  } = {},
): Buffer {
  const koepfe: Buffer[] = []
  const verzeichnis: Buffer[] = []
  let offset = 0
  for (const [name, inhalt] of Object.entries(teile)) {
    const roh = Buffer.from(inhalt, 'utf8')
    const daten = packen ? deflateRawSync(roh) : roh
    const namensBytes = Buffer.from(name, 'utf8')
    const entpackt = entpacktAngabe ?? roh.length

    const kopf = Buffer.alloc(30)
    kopf.writeUInt32LE(0x04034b50, 0)
    kopf.writeUInt16LE(20, 4)
    kopf.writeUInt16LE(packen ? 8 : 0, 8)
    kopf.writeUInt32LE(crc32(roh), 14)
    kopf.writeUInt32LE(daten.length, 18)
    kopf.writeUInt32LE(entpackt, 22)
    kopf.writeUInt16LE(namensBytes.length, 26)
    koepfe.push(kopf, namensBytes, daten)

    const eintrag = Buffer.alloc(46)
    eintrag.writeUInt32LE(0x02014b50, 0)
    eintrag.writeUInt16LE(20, 4)
    eintrag.writeUInt16LE(20, 6)
    eintrag.writeUInt16LE(packen ? 8 : 0, 10)
    eintrag.writeUInt32LE(crc32(roh), 16)
    eintrag.writeUInt32LE(daten.length, 20)
    eintrag.writeUInt32LE(entpackt, 24)
    eintrag.writeUInt16LE(namensBytes.length, 28)
    eintrag.writeUInt32LE(offset, 42)
    verzeichnis.push(eintrag, namensBytes)

    offset += 30 + namensBytes.length + daten.length
  }
  const verzeichnisBytes = Buffer.concat(verzeichnis)
  const ende = Buffer.alloc(22)
  ende.writeUInt32LE(0x06054b50, 0)
  ende.writeUInt16LE(Object.keys(teile).length, 8)
  ende.writeUInt16LE(Object.keys(teile).length, 10)
  ende.writeUInt32LE(verzeichnisBytes.length, 12)
  ende.writeUInt32LE(offset, 16)
  return Buffer.concat([...koepfe, verzeichnisBytes, ende])
}

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('Text aus Word', () => {
  it('liest Absätze, Tabulatoren und Sonderzeichen', () => {
    const dokument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Mietvertrag</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Miete:</w:t></w:r><w:r><w:tab/><w:t>CHF 1&apos;850.–</w:t></w:r></w:p>
<w:p><w:r><w:t>Müller &amp; Söhne</w:t><w:br/><w:t>Zürich</w:t></w:r></w:p>
</w:body></w:document>`
    const text = officeText(zip({ 'word/document.xml': dokument }), 'word')

    assert.equal(text.trim(), "Mietvertrag\nMiete:\tCHF 1'850.–\nMüller & Söhne\nZürich")
  })

  it('lässt Feldbefehle, gelöschten Text und doppelte Textfelder weg', () => {
    const dokument = `<w:document><w:body>
<w:p><w:r><w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:t>Seite 1</w:t></w:r></w:p>
<w:p><w:del><w:r><w:delText>alt</w:delText></w:r></w:del><w:r><w:t>neu</w:t></w:r></w:p>
<w:p><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>Im Kasten</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>Im Kasten</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:p>
</w:body></w:document>`
    const text = officeText(zip({ 'word/document.xml': dokument }), 'word')

    assert.doesNotMatch(text, /PAGE|MERGEFORMAT|alt/)
    assert.equal(text.match(/Im Kasten/g)?.length, 1)
    assert.match(text, /Seite 1\nneu/)
  })

  it('kennt Umbrüche mit Angaben – Seitenumbruch in Word, Zeilenumbruch in PowerPoint', () => {
    const word = officeText(
      zip({
        'word/document.xml':
          '<w:p><w:r><w:t>Seite eins</w:t><w:br w:type="page"/><w:t>Seite zwei</w:t></w:r></w:p>',
      }),
      'word',
    )
    assert.equal(word.trim(), 'Seite eins\nSeite zwei')

    const folie = officeText(
      zip({
        'ppt/slides/slide1.xml':
          '<a:p><a:r><a:t>Oben</a:t></a:r><a:br><a:rPr lang="de-CH"/></a:br><a:r><a:t>Unten</a:t></a:r></a:p>',
      }),
      'powerpoint',
    )
    assert.equal(folie.trim(), 'Oben\nUnten')
  })

  it('packt nichts aus, was grösser wäre als erlaubt', () => {
    const vierzigMegabyte = 'a'.repeat(40 * 1024 * 1024)
    // Ehrlich angegeben: wird gar nicht erst ausgepackt.
    assert.throws(
      () => officeText(zip({ 'word/document.xml': vierzigMegabyte }), 'word'),
      /zu gross/,
    )
    // Gelogen – angeblich zehn Byte: Das Auspacken bricht an der Grenze ab.
    assert.throws(() =>
      officeText(zip({ 'word/document.xml': vierzigMegabyte }, { entpacktAngabe: 10 }), 'word'),
    )
  })

  it('hört bei sehr vielen Folien auf, bevor der Server minutenlang auspackt', () => {
    // Fünf Folien à 25 MB ohne Text: jede für sich erlaubt, zusammen zu viel.
    const leer = `<p:sld>${' '.repeat(25 * 1024 * 1024)}</p:sld>`
    const folien = Object.fromEntries(
      [1, 2, 3, 4, 5].map((nummer) => [`ppt/slides/slide${nummer}.xml`, leer]),
    )
    assert.throws(() => officeText(zip(folien), 'powerpoint'), /zu gross/)
  })

  it('liest auch ungepackte Einträge', () => {
    const text = officeText(
      zip(
        { 'word/document.xml': '<w:p><w:r><w:t>Ohne Kompression</w:t></w:r></w:p>' },
        { packen: false },
      ),
      'word',
    )
    assert.equal(text.trim(), 'Ohne Kompression')
  })

  it('meldet eine Datei ohne Dokumenttext', () => {
    assert.throws(() => officeText(zip({ 'irgendwas.xml': '<a/>' }), 'word'), /Kein Word-Dokument/)
    assert.throws(() => officeText(Buffer.from('kein zip'), 'word'), /Kein ZIP-Archiv/)
  })
})

describe('Text aus Excel, PowerPoint und LibreOffice', () => {
  it('liest die Texte der Zellen einer Tabelle', () => {
    const texte = `<sst><si><t>Nebenkosten</t></si><si><r><t>Heiz</t></r><r><t>ung</t></r></si><si><t>Wasser</t><rPh><t>ミズ</t></rPh></si></sst>`
    const text = officeText(zip({ 'xl/sharedStrings.xml': texte }), 'excel')
    assert.deepEqual(text.trim().split('\n'), ['Nebenkosten', 'Heizung', 'Wasser'])
  })

  it('liest Texte, die direkt in den Zellen der Blätter stehen', () => {
    const blatt = `<worksheet><sheetData><row r="1">
<c r="A1" t="inlineStr"><is><t>Stromzähler</t></is></c>
<c r="B1"><v>4711</v></c>
<c r="C1" t="inlineStr"><is><r><t>Haupt</t></r><r><t>leitung</t></r></is></c>
</row></sheetData></worksheet>`
    const text = officeText(
      zip({ 'xl/workbook.xml': '<workbook/>', 'xl/worksheets/sheet1.xml': blatt }),
      'excel',
    )
    assert.deepEqual(text.split('\n'), ['Stromzähler', 'Hauptleitung'])
  })

  it('gibt bei einer Tabelle ohne Texte nichts zurück', () => {
    assert.equal(officeText(zip({ 'xl/workbook.xml': '<workbook/>' }), 'excel'), '')
  })

  it('liest Folien in ihrer Reihenfolge – Folie 2 vor Folie 10', () => {
    const folie = (text: string) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`
    const text = officeText(
      zip({
        'ppt/slides/slide10.xml': folie('Zehn'),
        'ppt/slides/slide2.xml': folie('Zwei'),
        'ppt/slides/slide1.xml': folie('Eins'),
        'ppt/notesSlides/notesSlide1.xml': folie('Notiz'),
      }),
      'powerpoint',
    )
    assert.deepEqual(text.split(/\n+/).filter(Boolean), ['Eins', 'Zwei', 'Zehn'])
  })

  it('liest LibreOffice-Text mit Leerzeichen, Umbrüchen und Tabellen', () => {
    const inhalt = `<office:document-content><office:body><office:text>
<text:h>Titel</text:h>
<text:p>Eins<text:s text:c="3"/>Zwei<text:line-break/>Drei<text:tab/>Vier</text:p>
<text:p><text:span>mit Span</text:span><office:annotation><text:p>Kommentar</text:p></office:annotation></text:p>
<table:table><table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell><text:p>B1</text:p></table:table-cell></table:table-row></table:table>
</office:text></office:body></office:document-content>`
    const text = officeText(zip({ 'content.xml': inhalt }), 'opendocument')
    assert.match(text, /Titel\n/)
    assert.match(text, /Eins {3}Zwei\nDrei\tVier/)
    assert.match(text, /mit Span/)
    assert.doesNotMatch(text, /Kommentar/)
    assert.match(text, /A1\n\tB1\n\t\n/)
  })

  it('kennt die Office-Arten an ihrem Typ', () => {
    assert.equal(officeArt(WORD), 'word')
    assert.equal(officeArt('application/vnd.oasis.opendocument.spreadsheet'), 'opendocument')
    assert.equal(officeArt('application/msword'), null)
    assert.equal(officeArt('application/pdf'), null)
  })
})

describe('Text aus RTF', () => {
  it('liest Absätze und Umlaute, ohne Schriften und Metadaten', () => {
    const rtf =
      String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fnil Calibri;}}{\colortbl ;\red255\green0\blue0;}{\*\generator Riched20 10.0}\viewkind4\uc1
\pard\f0\fs22 Sch\'f6ne Gr\'fc\'dfe\par
{\b Rechnung} Nr.\tab 42\par
Preis: 12` +
      // Nicht im String.raw: Beim Entfernen der Typen macht Node aus 荤
      // sonst schon das Zeichen selbst.
      '\\u8364?\\par\n}'
    assert.equal(rtfText(rtf).trim(), 'Schöne Grüße\nRechnung Nr.\t42\nPreis: 12€')
  })

  it('überspringt eingebettete Bilder und Feldbefehle, behält aber den Feldtext', () => {
    const rtf = String.raw`{\rtf1{\pict\pngblip 89504e47}{\field{\*\fldinst HYPERLINK "https://example.ch"}{\fldrslt Webseite}}\par}`
    assert.equal(rtfText(rtf).trim(), 'Webseite')
  })
})

describe('Klartext', () => {
  it('liest UTF-8, UTF-16 und die alte Windows-Kodierung', () => {
    assert.equal(klartext(Buffer.from('Grüsse aus Zürich', 'utf8')), 'Grüsse aus Zürich')
    assert.equal(
      klartext(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Zürich', 'utf16le')])),
      'Zürich',
    )
    assert.equal(klartext(Buffer.from([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68])), 'Zürich')
  })

  it('begrenzt die Textmenge für die Suche', () => {
    assert.ok(MAX_TEXT_CHARS >= 100_000)
  })
})

describe('Text aus Dateien, die ihn in sich tragen', () => {
  let ordner = ''
  before(async () => {
    ordner = await mkdtemp(join(tmpdir(), 'manager-office-'))
  })
  after(async () => {
    await rm(ordner, { recursive: true, force: true })
  })

  async function datei(name: string, inhalt: string | Buffer): Promise<string> {
    const pfad = join(ordner, name)
    await writeFile(pfad, inhalt)
    return pfad
  }

  it('liest Word, Klartext, CSV und RTF aus der Datei', async () => {
    const word = await datei(
      'vertrag.docx',
      zip({ 'word/document.xml': '<w:p><w:r><w:t>Mietvertrag</w:t></w:r></w:p>' }),
    )
    assert.equal((await eingebetteterText(word, WORD))?.trim(), 'Mietvertrag')

    assert.equal(
      await eingebetteterText(await datei('notiz.txt', 'Zählerstand 4711'), 'text/plain'),
      'Zählerstand 4711',
    )
    assert.equal(
      await eingebetteterText(await datei('liste.csv', 'Datum;Betrag\n1.10.;12.50'), 'text/csv'),
      'Datum;Betrag\n1.10.;12.50',
    )
    const rtf = await datei(
      'brief.rtf',
      Buffer.from(String.raw`{\rtf1\ansi Liebe Gr\'fc\'dfe\par}`, 'latin1'),
    )
    assert.equal((await eingebetteterText(rtf, 'application/rtf'))?.trim(), 'Liebe Grüße')
  })

  it('meldet bei alten Office-Dateien, dass es keinen Text gibt – ohne es zu versuchen', async () => {
    const alt = await datei('vertrag.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    await assert.rejects(eingebetteterText(alt, 'application/msword'), (fehler) => {
      assert.ok(fehler instanceof KeinTextError)
      assert.match(fehler.message, /\.doc, \.xls, \.ppt/)
      return true
    })
  })

  it('überlässt PDFs und Bilder der Texterkennung', async () => {
    assert.equal(await eingebetteterText(await datei('scan.pdf', '%PDF'), 'application/pdf'), null)
    assert.equal(await eingebetteterText(await datei('foto.jpg', 'x'), 'image/jpeg'), null)
  })

  it('wirft bei einer kaputten Office-Datei einen gewöhnlichen Fehler, nicht „kein Text"', async () => {
    const kaputt = await datei('kaputt.docx', 'kein zip')
    await assert.rejects(
      eingebetteterText(kaputt, WORD),
      (fehler) => !(fehler instanceof KeinTextError),
    )
  })
})
