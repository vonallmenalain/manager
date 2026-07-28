import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashPassword, verifyPassword } from './password.ts'

describe('Passwort-Hashing', () => {
  it('erkennt das richtige Passwort wieder', async () => {
    const hash = await hashPassword('korrekt-pferd-batterie')
    assert.equal(await verifyPassword(hash, 'korrekt-pferd-batterie'), true)
  })

  it('weist ein falsches Passwort ab', async () => {
    const hash = await hashPassword('korrekt-pferd-batterie')
    assert.equal(await verifyPassword(hash, 'korrekt-pferd-batteri'), false)
  })

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes', async () => {
    // Sonst wäre der Salt nicht zufällig und zwei Konten mit gleichem
    // Passwort wären in der Datenbank als solche erkennbar.
    const a = await hashPassword('dasselbe-passwort')
    const b = await hashPassword('dasselbe-passwort')
    assert.notEqual(a, b)
    assert.equal(await verifyPassword(a, 'dasselbe-passwort'), true)
    assert.equal(await verifyPassword(b, 'dasselbe-passwort'), true)
  })

  it('nutzt argon2id', async () => {
    const hash = await hashPassword('irgendwas-langes')
    assert.match(hash, /^\$argon2id\$/)
  })

  it('scheitert nicht an einem kaputten Hash, sondern gibt false zurück', async () => {
    // Ein beschädigter Eintrag in der Datenbank darf keinen 500er auslösen,
    // sondern muss sich wie ein fehlgeschlagener Login verhalten.
    assert.equal(await verifyPassword('kein-gueltiger-hash', 'egal'), false)
    assert.equal(await verifyPassword('', 'egal'), false)
  })
})
