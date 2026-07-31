import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Multipart, MultipartFields } from '@fastify/multipart'

import { metadataFromFields, titleFromFields, titleFromFilename } from './upload-fields.ts'

/** Ein Formularfeld, wie es @fastify/multipart hinterlegt. */
function named(name: string, value: unknown): Multipart {
  return {
    type: 'field',
    value,
    fieldname: name,
    mimetype: 'text/plain',
    encoding: '7bit',
    fieldnameTruncated: false,
    valueTruncated: false,
    fields: {},
  } as Multipart
}

function field(value: unknown): MultipartFields {
  return { title: named('title', value) }
}

function fields(entries: Record<string, unknown>): MultipartFields {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, named(name, value)]),
  ) as MultipartFields
}

describe('titleFromFilename', () => {
  it('nimmt Endung und Trennzeichen heraus', () => {
    assert.equal(titleFromFilename('Rechnung Krankenkasse_Maerz.pdf'), 'Rechnung Krankenkasse Maerz')
  })

  it('kommt ohne Endung aus', () => {
    assert.equal(titleFromFilename('Quittung'), 'Quittung')
  })

  it('lässt nie einen leeren Titel entstehen', () => {
    assert.equal(titleFromFilename('.pdf'), 'Ohne Titel')
  })
})

describe('titleFromFields', () => {
  it('nimmt den mitgeschickten Titel', () => {
    assert.equal(titleFromFields(field('Zahnarztrechnung Juli')), 'Zahnarztrechnung Juli')
  })

  it('macht aus einem Zeilenumbruch ein Leerzeichen', () => {
    // Aus der Zwischenablage gerät schnell einer hinein; in der Liste stünde
    // sonst ein Titel mit einem Zeilenumbruch mitten drin.
    assert.equal(titleFromFields(field('Vertrag\nMobilfunk')), 'Vertrag Mobilfunk')
  })

  it('ignoriert ein leeres Feld', () => {
    assert.equal(titleFromFields(field('   ')), null)
  })

  it('ignoriert einen überlangen Titel, statt den Upload abzulehnen', () => {
    // Die Datei ist zu diesem Zeitpunkt längst übertragen – sie deswegen
    // wegzuwerfen wäre die schlechtere Antwort als der Dateiname.
    assert.equal(titleFromFields(field('x'.repeat(201))), null)
  })

  it('kommt ohne Feld und mit fehlenden Feldern aus', () => {
    assert.equal(titleFromFields(undefined), null)
    assert.equal(titleFromFields({}), null)
  })

  it('nimmt keinen Titel aus einem Dateifeld', () => {
    const fields = {
      title: { type: 'file', filename: 'boese.txt' },
    } as unknown as MultipartFields
    assert.equal(titleFromFields(fields), null)
  })

  it('nimmt bei mehrfach gesendetem Feld das erste', () => {
    const doppelt = { title: [field('Erster').title, field('Zweiter').title] } as MultipartFields
    assert.equal(titleFromFields(doppelt), 'Erster')
  })
})

describe('metadataFromFields', () => {
  it('nimmt Bereich, Kategorie, Zuständigkeit und Status mit', () => {
    assert.deepEqual(
      metadataFromFields(
        fields({
          bereich: 'docbase',
          categoryId: 'e6c0a4d2-0000-4000-8000-000000000001',
          assignedTo: 'e6c0a4d2-0000-4000-8000-000000000002',
          status: 'erledigt',
        }),
      ),
      {
        bereich: 'docbase',
        categoryId: 'e6c0a4d2-0000-4000-8000-000000000001',
        assignedTo: 'e6c0a4d2-0000-4000-8000-000000000002',
        status: 'erledigt',
      },
    )
  })

  it('bleibt ohne Angaben beim Haushalt: unsortiert, beide und pendent', () => {
    assert.deepEqual(metadataFromFields(undefined), {
      bereich: 'manager',
      categoryId: null,
      assignedTo: null,
      status: 'pendent',
    })
    assert.deepEqual(metadataFromFields({}), {
      bereich: 'manager',
      categoryId: null,
      assignedTo: null,
      status: 'pendent',
    })
  })

  it('verwirft einen unbekannten Bereich, statt in der DocBase zu landen', () => {
    // Ein Tippfehler oder eine ältere Fassung der App darf kein Dokument in
    // eine Sammlung schreiben, die es nicht gibt – dann eben in den Haushalt.
    assert.equal(metadataFromFields(fields({ bereich: 'archiv' })).bereich, 'manager')
  })

  it('verwirft einen unbekannten Status, statt den Upload abzulehnen', () => {
    // Etwa aus einer älteren Fassung der App, die noch „offen" kannte.
    assert.equal(metadataFromFields(fields({ status: 'offen' })).status, 'pendent')
  })

  it('verwirft leere und überlange Kennungen', () => {
    assert.equal(metadataFromFields(fields({ categoryId: '   ' })).categoryId, null)
    assert.equal(metadataFromFields(fields({ assignedTo: 'x'.repeat(61) })).assignedTo, null)
  })

  it('nimmt keine Kennung aus einem Dateifeld', () => {
    const untergeschoben = {
      categoryId: { type: 'file', filename: 'boese.txt' },
    } as unknown as MultipartFields
    assert.equal(metadataFromFields(untergeschoben).categoryId, null)
  })
})
