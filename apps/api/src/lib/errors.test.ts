import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loginSchema, passwordSchema } from '@manager/shared'
import { z } from 'zod'

import { validationError } from './errors.ts'

describe('Fehler-Aufbereitung', () => {
  it('ordnet jede Meldung ihrem Feld zu', () => {
    const result = loginSchema.safeParse({ email: 'kein-email', password: '' })
    assert.equal(result.success, false)

    const body = validationError(result.error)
    assert.equal(body.error.code, 'validation_failed')
    assert.ok(body.error.fields?.email)
    assert.ok(body.error.fields?.password)
  })

  it('behält pro Feld nur die erste Meldung', () => {
    // Auf einem Handy ist unter dem Eingabefeld Platz für eine Zeile.
    const schema = z.object({
      wert: z.string().min(5, 'zu kurz').regex(/^\d+$/, 'nur Ziffern'),
    })
    const result = schema.safeParse({ wert: 'ab' })
    assert.equal(result.success, false)

    const body = validationError(result.error)
    assert.equal(body.error.fields?.wert, 'zu kurz')
  })

  it('gibt eine deutschsprachige Meldung für die Passwortlänge', () => {
    const result = passwordSchema.safeParse('kurz')
    assert.equal(result.success, false)
    assert.match(result.error.issues[0]!.message, /mindestens 10 Zeichen/)
  })
})
