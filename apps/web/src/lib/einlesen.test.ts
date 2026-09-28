import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_UPLOAD_BYTES } from '@manager/shared'

import {
  dateiEinlesen,
  einlesen,
  einlesenEinzeln,
  MAX_AUSWAHL_BYTES,
  meldungUnlesbar,
  unlesbareDatei,
} from './einlesen.ts'

/**
 * Eine Datei, an deren Inhalt Chrome nicht mehr herankommt – wie eine aus
 * Google Drive, die nur dort liegt oder sich nach der Auswahl geändert hat.
 */
class UnlesbareDatei extends File {
  override arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.reject(
      new DOMException('The requested file could not be read', 'NotReadableError'),
    )
  }

  override slice(): Blob {
    return new UnlesbareDatei([], this.name)
  }
}

describe('Gewählte Dateien einlesen', () => {
  it('kopiert eine Datei samt Name und Typ in den Arbeitsspeicher', async () => {
    const original = new File(['%PDF-1.7 Rechnung'], 'Rechnung.pdf', {
      type: 'application/pdf',
      lastModified: 1_700_000_000_000,
    })

    const ergebnis = await dateiEinlesen(original)

    assert.ok(ergebnis.ok)
    assert.notEqual(ergebnis.datei, original)
    assert.equal(ergebnis.datei.name, 'Rechnung.pdf')
    assert.equal(ergebnis.datei.type, 'application/pdf')
    assert.equal(ergebnis.datei.lastModified, 1_700_000_000_000)
    assert.equal(await ergebnis.datei.text(), '%PDF-1.7 Rechnung')
  })

  it('sagt bei einer unlesbaren Datei, was stattdessen geht', async () => {
    const ergebnis = await dateiEinlesen(new UnlesbareDatei(['x'], 'Aus Drive.pdf'))

    assert.deepEqual(ergebnis, { ok: false, meldung: meldungUnlesbar('Aus Drive.pdf') })
    assert.match(
      meldungUnlesbar('Aus Drive.pdf'),
      /„Aus Drive\.pdf".*Google Drive.*Herunterladen.*Downloads/,
    )
  })

  it('behandelt eine leere Datei wie eine unlesbare', async () => {
    const ergebnis = await dateiEinlesen(new File([], 'Leer.pdf', { type: 'application/pdf' }))

    assert.deepEqual(ergebnis, { ok: false, meldung: meldungUnlesbar('Leer.pdf') })
  })

  it('liest eine zu grosse Datei gar nicht erst', async () => {
    const gross = new UnlesbareDatei(['x'], 'Riesig.pdf')
    Object.defineProperty(gross, 'size', { value: MAX_UPLOAD_BYTES + 1 })

    const ergebnis = await dateiEinlesen(gross)

    assert.deepEqual(ergebnis, { ok: false, meldung: '„Riesig.pdf" ist grösser als 50 MB.' })
  })

  it('behält die Reihenfolge und trennt Lesbares von Unlesbarem', async () => {
    const { dateien, probleme } = await einlesen([
      new File(['eins'], 'eins.pdf'),
      new UnlesbareDatei(['zwei'], 'zwei.pdf'),
      new File(['drei'], 'drei.jpg'),
    ])

    assert.deepEqual(
      dateien.map((datei) => datei.name),
      ['eins.pdf', 'drei.jpg'],
    )
    assert.deepEqual(probleme, [meldungUnlesbar('zwei.pdf')])
  })
})

/** Eine Datei, die so gross tut – ohne so viel Speicher zu brauchen. */
function mitGroesse(name: string, bytes: number): File {
  const datei = new File(['x'], name)
  Object.defineProperty(datei, 'size', { value: bytes })
  return datei
}

describe('Eine Auswahl mit vielen oder grossen Dateien', () => {
  const MB = 1024 * 1024

  it('liest zusammen nur bis zur Obergrenze', async () => {
    const { dateien, probleme } = await einlesen([
      mitGroesse('a.pdf', 40 * MB),
      mitGroesse('b.pdf', 40 * MB),
      mitGroesse('c.pdf', 40 * MB),
      mitGroesse('d.pdf', 10 * MB),
    ])

    assert.equal(MAX_AUSWAHL_BYTES, 100 * MB)
    // Die dritte passt nicht mehr, die kleine vierte schon.
    assert.deepEqual(
      dateien.map((datei) => datei.name),
      ['a.pdf', 'b.pdf', 'd.pdf'],
    )
    assert.equal(probleme.length, 1)
    assert.match(probleme[0] ?? '', /„c\.pdf" wurde nicht gelesen.*100 MB.*kleineren Portionen/)
  })

  it('zählt eine einzelne zu grosse Datei nicht mit', async () => {
    const ergebnisse = await einlesenEinzeln([
      mitGroesse('riesig.pdf', 60 * MB),
      mitGroesse('a.pdf', 45 * MB),
      mitGroesse('b.pdf', 45 * MB),
    ])

    assert.deepEqual(
      ergebnisse.map((ergebnis) => (ergebnis.ok ? ergebnis.datei.name : ergebnis.meldung)),
      ['„riesig.pdf" ist grösser als 50 MB.', 'a.pdf', 'b.pdf'],
    )
  })

  it('liest eine Datei nach der anderen, nicht alle zugleich', async () => {
    let gleichzeitig = 0
    let hoechstens = 0
    class LangsameDatei extends File {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        gleichzeitig += 1
        hoechstens = Math.max(hoechstens, gleichzeitig)
        await new Promise((fertig) => setTimeout(fertig, 5))
        gleichzeitig -= 1
        return super.arrayBuffer()
      }
    }

    const { dateien } = await einlesen([
      new LangsameDatei(['a'], 'a.pdf'),
      new LangsameDatei(['b'], 'b.pdf'),
      new LangsameDatei(['c'], 'c.pdf'),
    ])

    assert.equal(dateien.length, 3)
    assert.equal(hoechstens, 1)
  })
})

describe('Nach einem abgebrochenen Hochladen', () => {
  it('findet die Datei, die sich nicht mehr lesen lässt', async () => {
    const body = new FormData()
    body.append('bereich', 'manager')
    body.append('file', new UnlesbareDatei(['x'], 'Aus Drive.pdf'))

    assert.equal((await unlesbareDatei(body))?.name, 'Aus Drive.pdf')
  })

  it('findet nichts, wenn alle Dateien lesbar sind', async () => {
    const body = new FormData()
    body.append('title', 'Rechnung')
    body.append('file', new File(['%PDF'], 'Rechnung.pdf'))

    assert.equal(await unlesbareDatei(body), null)
  })
})
