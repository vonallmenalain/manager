import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ALLOWED_EXTENSIONS,
  fileKindLabel,
  isAllowedMimeType,
  uploadMimeType,
} from '@manager/shared'

import { extensionFor } from './storage-paths.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('Welche Dateien in die Ablage dürfen', () => {
  it('nimmt Office-, LibreOffice-, RTF-, Text- und CSV-Dateien an', () => {
    for (const typ of [
      DOCX,
      XLSX,
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/rtf',
      'text/plain',
      'text/csv',
    ]) {
      assert.ok(isAllowedMimeType(typ), typ)
    }
  })

  it('lässt Archive und Programme weiterhin draussen', () => {
    assert.equal(isAllowedMimeType('application/zip'), false)
    assert.equal(isAllowedMimeType('application/vnd.android.package-archive'), false)
    assert.equal(isAllowedMimeType(uploadMimeType('application/octet-stream', 'setup.exe')), false)
  })

  it('erkennt Office-Dateien am Namen, wenn der Typ fehlt oder allgemein ist', () => {
    assert.equal(uploadMimeType('application/octet-stream', 'Mietvertrag.DOCX'), DOCX)
    assert.equal(uploadMimeType('', 'Nebenkosten 2026.xlsx'), XLSX)
    assert.equal(uploadMimeType(null, 'notiz.txt'), 'text/plain')
  })

  it('lässt bei ungenauen Office-Typen die Endung entscheiden', () => {
    // Windows meldet CSV als Excel, manche Apps ein .docx als altes Word.
    assert.equal(uploadMimeType('application/msword', 'Mietvertrag.docx'), DOCX)
    assert.equal(uploadMimeType('application/vnd.ms-excel', 'liste.csv'), 'text/csv')
    assert.equal(uploadMimeType('application/vnd.ms-excel', 'Nebenkosten.xlsx'), XLSX)
    assert.equal(uploadMimeType('text/plain', 'daten.csv'), 'text/csv')
    assert.equal(uploadMimeType('text/plain', 'brief.rtf'), 'application/rtf')
    // Stimmt der Typ, bleibt er – auch ohne passende Endung.
    assert.equal(uploadMimeType('application/msword', 'alt.doc'), 'application/msword')
    assert.equal(uploadMimeType('application/msword', 'ohne-endung'), 'application/msword')
    assert.equal(uploadMimeType('text/plain', 'notiz.txt'), 'text/plain')
  })

  it('lässt genaue Typen nicht von der Endung überstimmen', () => {
    assert.equal(uploadMimeType('application/pdf', 'rechnung.txt'), 'application/pdf')
    assert.equal(uploadMimeType('image/png', 'bild.jpg'), 'image/png')
    assert.equal(uploadMimeType('text/plain', 'scan.pdf'), 'text/plain')
  })

  it('übersetzt ältere Schreibweisen', () => {
    assert.equal(uploadMimeType('text/rtf', 'brief.rtf'), 'application/rtf')
    assert.equal(uploadMimeType('text/comma-separated-values', 'liste.csv'), 'text/csv')
  })

  it('bietet die Endungen für Auswahlfenster an', () => {
    for (const endung of ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'odt', 'rtf', 'txt', 'csv']) {
      assert.ok(ALLOWED_EXTENSIONS.includes(endung), endung)
    }
  })

  it('benennt die Dateiarten', () => {
    assert.equal(fileKindLabel('application/pdf'), 'PDF')
    assert.equal(fileKindLabel('image/png'), 'Bild')
    assert.equal(fileKindLabel(DOCX), 'Word')
    assert.equal(fileKindLabel('application/vnd.ms-excel'), 'Excel')
    assert.equal(fileKindLabel('text/plain'), 'Text')
    assert.equal(fileKindLabel('application/x-unbekannt'), 'Datei')
  })

  it('legt Office-Dateien mit ihrer Endung ab', () => {
    assert.equal(extensionFor(DOCX, 'x'), 'docx')
    assert.equal(extensionFor('application/msword', 'x'), 'doc')
    assert.equal(extensionFor('text/csv', 'x'), 'csv')
    assert.equal(extensionFor('application/vnd.oasis.opendocument.spreadsheet', 'x'), 'ods')
  })
})
