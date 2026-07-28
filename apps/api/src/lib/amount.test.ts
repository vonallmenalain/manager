import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatAmount, parseAmountToCents } from '@manager/shared'

describe('Betragseingabe', () => {
  it('versteht die Schreibweisen, die im Alltag vorkommen', () => {
    assert.equal(parseAmountToCents('1234.55'), 123455)
    assert.equal(parseAmountToCents('1234,55'), 123455)
    assert.equal(parseAmountToCents("1'234.55"), 123455)
    // Genau die Form, welche die App selbst ausgibt – wer sie kopiert und
    // wieder einfügt, darf nicht auf einen Fehler laufen.
    assert.equal(parseAmountToCents('1’234.55'), 123455)
    assert.equal(parseAmountToCents('1 234.55'), 123455)
    assert.equal(parseAmountToCents(' 48.25 '), 4825)
  })

  it('rechnet in Rappen und rundet korrekt', () => {
    assert.equal(parseAmountToCents('0.1'), 10)
    assert.equal(parseAmountToCents('0.005'), 1)
    // 19.99 ist als Gleitkommazahl nicht exakt darstellbar; ohne Rundung
    // käme hier 1998 heraus.
    assert.equal(parseAmountToCents('19.99'), 1999)
  })

  it('gibt null zurück statt zu raten', () => {
    assert.equal(parseAmountToCents(''), null)
    assert.equal(parseAmountToCents('   '), null)
    assert.equal(parseAmountToCents('abc'), null)
    assert.equal(parseAmountToCents('-5'), null)
    assert.equal(parseAmountToCents('99999999'), null)
  })

  it('formatiert und liest den eigenen Ausgabewert wieder ein', () => {
    for (const cents of [0, 5, 4825, 123455, 100000000]) {
      const roundTrip = parseAmountToCents(formatAmount(cents))
      assert.equal(roundTrip, cents, `Rundlauf fehlgeschlagen für ${cents}`)
    }
  })
})
