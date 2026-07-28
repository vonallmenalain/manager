import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { MultipartFields } from '@fastify/multipart'

import { titleFromFields, titleFromFilename } from './upload-title.ts'

/** Ein Formularfeld, wie es @fastify/multipart hinterlegt. */
function field(value: unknown): MultipartFields {
  return {
    title: {
      type: 'field',
      value,
      fieldname: 'title',
      mimetype: 'text/plain',
      encoding: '7bit',
      fieldnameTruncated: false,
      valueTruncated: false,
      fields: {},
    },
  }
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
    const fields = { title: [field('Erster').title, field('Zweiter').title] } as MultipartFields
    assert.equal(titleFromFields(fields), 'Erster')
  })
})
