import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  parsePageCount,
  PREVIEW_MAX_PAGES,
  previewPagePath,
  previewThumbnailPath,
} from './preview-paths.ts'

describe('parsePageCount', () => {
  it('liest die Seitenzahl aus einer gewöhnlichen pdfinfo-Ausgabe', () => {
    const stdout = [
      'Title:          Rechnung März 2026',
      'Producer:       LibreOffice 7.4',
      'Pages:          5',
      'Page size:      595 x 842 pts (A4)',
      'File size:      182734 bytes',
    ].join('\n')

    assert.equal(parsePageCount(stdout), 5)
  })

  it('kommt ohne Zeilenumbruch am Ende aus', () => {
    assert.equal(parsePageCount('Pages:          1'), 1)
  })

  it('meldet 0, wenn keine Seitenzahl in der Ausgabe steht', () => {
    // Passiert bei passwortgeschützten PDFs: pdfinfo läuft durch, gibt aber
    // nur die Metadaten heraus, die es ohne Passwort lesen kann.
    const stdout = ['Encrypted:      yes', 'File size:      9812 bytes'].join('\n')
    assert.equal(parsePageCount(stdout), 0)
  })

  it('meldet 0 bei leerer Ausgabe', () => {
    assert.equal(parsePageCount(''), 0)
  })

  it('lässt sich nicht von einer Zeile täuschen, die nur ähnlich aussieht', () => {
    // 'Pages:' mitten in einem Titel darf die echte Seitenzahl nicht
    // verdrängen – sonst blätterte die App zu Seiten, die es nicht gibt.
    const stdout = ['Title:          Yellow Pages: 300 Nummern', 'Pages:          2'].join('\n')
    assert.equal(parsePageCount(stdout), 2)
  })

  it('ignoriert eine Seitenzahl von 0', () => {
    assert.equal(parsePageCount('Pages:          0'), 0)
  })
})

describe('previewPagePath', () => {
  it('legt jede Seite unter der Dokument-ID ab', () => {
    assert.equal(
      previewPagePath('7f1c2e8a-0000-4000-8000-000000000001', 3),
      '.previews/7f1c2e8a-0000-4000-8000-000000000001/s3.jpg',
    )
  })

  it('legt das Vorschaubild neben die Seiten desselben Dokuments', () => {
    // Derselbe Ordner wie die Seiten: Beim Löschen und beim Ersetzen der Datei
    // verschwindet damit beides zugleich.
    assert.equal(
      previewThumbnailPath('7f1c2e8a-0000-4000-8000-000000000001'),
      '.previews/7f1c2e8a-0000-4000-8000-000000000001/vorschau.jpg',
    )
  })

  it('weist Seitennummern ab, die kein Dateiname sein dürfen', () => {
    // Die Nummer kommt aus der Adresszeile. Käme sie ungeprüft durch, liesse
    // sich mit '../' aus der Ablage herausschreiben.
    assert.throws(() => previewPagePath('doc', 0), /Ungültige Seitennummer/)
    assert.throws(() => previewPagePath('doc', -1), /Ungültige Seitennummer/)
    assert.throws(() => previewPagePath('doc', 1.5), /Ungültige Seitennummer/)
    assert.throws(() => previewPagePath('doc', Number.NaN), /Ungültige Seitennummer/)
    assert.throws(() => previewPagePath('doc', PREVIEW_MAX_PAGES + 1), /Ungültige Seitennummer/)
  })
})
