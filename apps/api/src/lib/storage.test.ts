import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  buildStoragePath,
  extensionFor,
  resolveWithin,
  slugify,
} from './storage-paths.ts'

const STORAGE_ROOT = join(tmpdir(), 'manager-storage-test')
const resolveInStorage = (relativePath: string) => resolveWithin(STORAGE_ROOT, relativePath)

describe('slugify', () => {
  it('schreibt deutsche Umlaute aus, statt sie zu entfernen', () => {
    // 'Vertrge' wäre unlesbar – gerade bei Dateinamen zählt das.
    assert.equal(slugify('Verträge'), 'Vertraege')
    assert.equal(slugify('Grüezi Öl Ähre'), 'Grueezi-Oel-Aehre')
    assert.equal(slugify('Strasse'), 'Strasse')
    assert.equal(slugify('Straße'), 'Strasse')
  })

  it('entfernt Akzente anderer Sprachen', () => {
    assert.equal(slugify('Café Genève'), 'Cafe-Geneve')
  })

  it('ersetzt alles, was in Dateinamen Ärger macht', () => {
    assert.equal(slugify('Rechnung 03/2026: Teil #2?'), 'Rechnung-03-2026-Teil-2')
    assert.equal(slugify('a\\b/c:d*e'), 'a-b-c-d-e')
  })

  it('liefert nie einen leeren Namen', () => {
    assert.equal(slugify(''), 'Dokument')
    assert.equal(slugify('///'), 'Dokument')
    assert.equal(slugify('   '), 'Dokument')
  })

  it('kürzt lange Titel ohne Trennstrich am Ende', () => {
    const result = slugify('a'.repeat(200))
    assert.equal(result.length, 60)
    assert.ok(!result.endsWith('-'))
  })
})

describe('buildStoragePath', () => {
  it('legt nach Jahr und Kategorie ab und bleibt lesbar', () => {
    const path = buildStoragePath({
      docDate: '2026-03-14',
      categoryName: 'Versicherung',
      title: 'Krankenkasse Prämie März',
      documentId: 'a3f9c1d2-0000-4000-8000-000000000000',
      extension: 'pdf',
    })
    assert.equal(path, '2026/Versicherung/2026-03-14__Krankenkasse-Praemie-Maerz__a3f9c1d2.pdf')
  })

  it('nutzt "Unsortiert", solange keine Kategorie gesetzt ist', () => {
    const path = buildStoragePath({
      docDate: '2026-01-05',
      categoryName: null,
      title: 'Post',
      documentId: 'b1c2d3e4-0000-4000-8000-000000000000',
      extension: 'pdf',
    })
    assert.equal(path, '2026/Unsortiert/2026-01-05__Post__b1c2d3e4.pdf')
  })

  it('trennt zwei gleichnamige Dokumente über die Kurz-ID', () => {
    const common = { docDate: '2026-05-01', categoryName: 'Wohnen', title: 'Nebenkosten', extension: 'pdf' }
    const first = buildStoragePath({ ...common, documentId: '11111111-0000-4000-8000-000000000000' })
    const second = buildStoragePath({ ...common, documentId: '22222222-0000-4000-8000-000000000000' })
    assert.notEqual(first, second)
  })
})

describe('resolveInStorage', () => {
  it('lässt Pfade innerhalb der Ablage zu', () => {
    const resolved = resolveInStorage('2026/Steuern/datei.pdf')
    assert.ok(resolved.startsWith(STORAGE_ROOT))
  })

  it('weist Ausbrüche aus der Ablage ab', () => {
    // Ohne diese Sperre könnte ein manipulierter Datenbankeintrag jede Datei
    // des NAS ausliefern.
    for (const evil of [
      '../../etc/passwd',
      '2026/../../../etc/shadow',
      '/etc/passwd',
      '..',
    ]) {
      assert.throws(() => resolveInStorage(evil), /ausserhalb der Ablage/, `nicht blockiert: ${evil}`)
    }
  })
})

describe('extensionFor', () => {
  it('leitet die Endung aus dem MIME-Typ ab', () => {
    assert.equal(extensionFor('application/pdf', 'irgendwas'), 'pdf')
    assert.equal(extensionFor('image/jpeg', 'foto.JPEG'), 'jpg')
  })

  it('fällt auf den Dateinamen zurück, wenn der MIME-Typ unbekannt ist', () => {
    assert.equal(extensionFor('application/octet-stream', 'archiv.zip'), 'zip')
  })

  it('akzeptiert keine wilden Endungen aus dem Dateinamen', () => {
    assert.equal(extensionFor('application/octet-stream', 'datei.../../sh'), 'bin')
    assert.equal(extensionFor('application/octet-stream', 'ohne-endung'), 'bin')
  })
})
