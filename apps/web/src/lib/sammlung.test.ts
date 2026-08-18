import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ManagedDocument, Note } from '@manager/shared'

import { mische } from './sammlung.ts'

function dokument(id: string, docDate: string, uploadedAt = `${docDate}T08:00:00.000Z`): ManagedDocument {
  return {
    id,
    title: id,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    status: 'pendent',
    categoryId: null,
    assignedTo: null,
    uploadedBy: 'u1',
    uploadedAt,
    docDate,
    dueDate: null,
    amountCents: null,
    vendor: null,
    notes: null,
    hasFile: true,
    ocrStatus: 'done',
    deletedAt: null,
    snippet: null,
  }
}

function notiz(id: string, updatedAt: string, pinned = false): Note {
  return {
    id,
    title: id,
    body: '',
    kind: 'text',
    bereich: 'docbase',
    categoryId: null,
    pinned,
    shared: true,
    color: 'default',
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('Dokumente und Notizen in einer Liste', () => {
  it('sortiert beide gemeinsam nach Datum, das Neueste zuoberst', () => {
    const eintraege = mische(
      [dokument('doc-alt', '2026-01-10'), dokument('doc-neu', '2026-03-01')],
      [notiz('notiz-mittig', '2026-02-14T09:00:00.000Z')],
    )

    assert.deepEqual(
      eintraege.map((eintrag) => eintrag.id),
      ['doc-neu', 'notiz-mittig', 'doc-alt'],
    )
  })

  it('stellt angeheftete Notizen über alles, auch über neuere Dokumente', () => {
    const eintraege = mische(
      [dokument('doc-heute', '2026-03-01')],
      [notiz('angeheftet', '2025-01-01T09:00:00.000Z', true)],
    )

    assert.deepEqual(
      eintraege.map((eintrag) => eintrag.id),
      ['angeheftet', 'doc-heute'],
    )
  })

  it('entscheidet bei gleichem Tag nach der Uhrzeit', () => {
    // Ein Dokument trägt nur ein Datum, eine Notiz einen Zeitstempel – am
    // selben Tag muss trotzdem eine Reihenfolge herauskommen, und zwar immer
    // dieselbe.
    const eintraege = mische(
      [dokument('doc-morgens', '2026-03-01', '2026-03-01T07:00:00.000Z')],
      [notiz('notiz-abends', '2026-03-01T20:00:00.000Z')],
    )

    assert.deepEqual(
      eintraege.map((eintrag) => eintrag.id),
      ['notiz-abends', 'doc-morgens'],
    )
  })

  it('kommt mit einer Sammlung ohne Notizen aus', () => {
    const eintraege = mische([dokument('doc', '2026-03-01')], [])
    assert.deepEqual(
      eintraege.map((eintrag) => eintrag.art),
      ['dokument'],
    )
  })
})
