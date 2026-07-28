import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildSearchText, findSnippet, normalizeForSearch, normalizeWithMap } from '@manager/shared'

describe('Vereinheitlichung für die Suche', () => {
  it('schreibt Umlaute aus und ignoriert Gross-/Kleinschreibung', () => {
    assert.equal(normalizeForSearch('Prämie'), 'praemie')
    assert.equal(normalizeForSearch('PRÄMIE'), 'praemie')
    assert.equal(normalizeForSearch('Praemie'), 'praemie')
    assert.equal(normalizeForSearch('März'), 'maerz')
    assert.equal(normalizeForSearch('Straße'), 'strasse')
    assert.equal(normalizeForSearch('Genève'), 'geneve')
  })

  it('fasst Leerraum zusammen und schneidet ihn an den Rändern ab', () => {
    assert.equal(normalizeForSearch('  Zwei   Wörter \n\t '), 'zwei woerter')
  })

  it('stimmt mit der Fassung überein, die die Positionen mitführt', () => {
    // Diese beiden dürfen sich nie unterscheiden: Sonst gäbe es Treffer, zu
    // denen kein Textausschnitt gefunden wird.
    for (const sample of [
      'Krankenkasse Prämie März',
      '  führende   Leerzeichen  ',
      'ÄÖÜ ähnlich Straße',
      'Café Genève, Zürich',
      '',
      '   ',
      'Zeilen\numbruch\tund Tabulator',
    ]) {
      assert.equal(
        normalizeWithMap(sample).text,
        normalizeForSearch(sample),
        `Abweichung bei ${JSON.stringify(sample)}`,
      )
    }
  })

  it('ordnet jedem Ergebniszeichen eine Position im Ursprungstext zu', () => {
    const { text, map } = normalizeWithMap('Prämie')
    assert.equal(text, 'praemie')
    assert.equal(map.length, text.length)
    // 'ä' an Position 2 erzeugt 'a' und 'e' – beide zeigen auf dieselbe Stelle.
    assert.equal(map[2], 2)
    assert.equal(map[3], 2)
    assert.equal(map[4], 3)
  })
})

describe('Textausschnitte', () => {
  const brief =
    'Sehr geehrte Frau von Allmen\nWir danken für Ihre Zahlung. Die Prämie für den ' +
    'Monat März 2026 beträgt CHF 482.50 und ist zahlbar bis 10.04.2026.\nFreundliche Grüsse'

  it('findet die Stelle und zeigt den Originaltext, nicht die Suchform', () => {
    const snippet = findSnippet(brief, 'praemie')
    assert.ok(snippet)
    assert.match(snippet.text, /Prämie/)
    assert.doesNotMatch(snippet.text, /praemie/)
  })

  it('markiert die Fundstelle im Ausschnitt', () => {
    const snippet = findSnippet(brief, 'März')
    assert.ok(snippet)
    const markiert = snippet.text.slice(snippet.matchStart, snippet.matchEnd)
    assert.equal(markiert, 'März')
  })

  it('kürzt lange Texte und zeigt die Kürzung an', () => {
    const snippet = findSnippet(brief, 'Prämie', 20)
    assert.ok(snippet)
    assert.ok(snippet.text.startsWith('…'), snippet.text)
    assert.ok(snippet.text.endsWith('…'), snippet.text)
    assert.ok(snippet.text.length < brief.length)
  })

  it('gibt null zurück, wenn nichts passt', () => {
    assert.equal(findSnippet(brief, 'Vollkaskoversicherung'), null)
    assert.equal(findSnippet(brief, ''), null)
    assert.equal(findSnippet('', 'irgendwas'), null)
  })

  it('findet auch quer über Zeilenumbrüche hinweg', () => {
    assert.ok(findSnippet('Zahlbar\nbis Ende Monat', 'zahlbar bis'))
  })
})

describe('Suchtext eines Dokuments', () => {
  it('führt Titel, Absender und Notiz zusammen', () => {
    const text = buildSearchText({
      title: 'Krankenkasse Prämie März',
      vendor: 'Helsana',
      notes: 'Bereits einbezahlt',
    })
    assert.match(text, /praemie/)
    assert.match(text, /helsana/)
    assert.match(text, /einbezahlt/)
  })

  it('kommt mit fehlenden Feldern zurecht', () => {
    assert.equal(buildSearchText({ title: 'Nur Titel' }), 'nur titel')
    assert.equal(buildSearchText({ title: 'X', vendor: null, notes: null }), 'x')
  })
})
