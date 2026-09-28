import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { DOCBASE_BASENAME, DOCBASE_SCOPE, MANAGER_SCOPE } from './appScopes.ts'
import {
  DOCBASE_SHARE_CACHE,
  DOCBASE_SHARE_LANDING_PATH,
  DOCBASE_SHARE_TARGET_PATH,
  LEGACY_SHARE_TARGET_PATH,
  SHARE_CACHE,
  SHARE_FILENAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_LANDING_PATH,
  SHARE_LANDING_ROUTE,
  SHARE_TARGET_PATH,
  SHARE_TEXT_KEY,
} from './shareConstants.ts'

/**
 * Das Teilen hängt an Namen, die an mehreren Stellen stehen müssen und nie
 * auseinanderlaufen dürfen: im Manifest, in den Workern, im Router – und im
 * Worker an der Wurzel, der ohne Bündler auskommen muss und seine Namen
 * deshalb von Hand trägt. Läuft einer davon auseinander, gibt es keine
 * Fehlermeldung. Das Teilen hört einfach auf zu funktionieren.
 */
describe('Teilen an die DocBase', () => {
  it('hat sein Ziel im Bereich der DocBase', () => {
    // Ein Teilen-Ziel ausserhalb des eigenen Bereichs lehnt der Browser ab –
    // die DocBase erschiene gar nicht erst im Teilen-Menü.
    assert.ok(DOCBASE_SHARE_TARGET_PATH.startsWith(DOCBASE_SCOPE))
    assert.ok(DOCBASE_SHARE_LANDING_PATH.startsWith(DOCBASE_SCOPE))
    assert.equal(`${DOCBASE_BASENAME}/${SHARE_LANDING_ROUTE}`, DOCBASE_SHARE_LANDING_PATH)
  })

  it('legt in einem eigenen Zwischenspeicher ab', () => {
    // Mit demselben Namen räumte jedes Teilen an die eine App das Geteilte der
    // anderen weg – und die Auswahlseite fände Fremdes.
    assert.notEqual(DOCBASE_SHARE_CACHE, SHARE_CACHE)
  })

  it('zielt nie in den Bereich der anderen App', () => {
    assert.ok(!DOCBASE_SHARE_TARGET_PATH.startsWith(MANAGER_SCOPE))
    assert.ok(!SHARE_TARGET_PATH.startsWith(DOCBASE_SCOPE))
  })
})

describe('Worker an der Wurzel (legacy-root/sw.js)', () => {
  const worker = readFileSync(new URL('../../legacy-root/sw.js', import.meta.url), 'utf8')

  /** Der Wert einer `const NAME = '…'` im Worker. */
  function konstante(name: string): string | undefined {
    return new RegExp(`const ${name} = '([^']*)'`).exec(worker)?.[1]
  }

  it('nimmt das alte Teilen-Ziel an', () => {
    assert.equal(konstante('SHARE_TARGET'), LEGACY_SHARE_TARGET_PATH)
    // Liegt das alte Ziel im Bereich des Managers, bräuchte es diesen Worker
    // nicht – und dann stimmte etwas an der Adresse nicht.
    assert.ok(!LEGACY_SHARE_TARGET_PATH.startsWith(MANAGER_SCOPE))
  })

  it('legt genau dort ab, wo die Auswahlseite des Managers sucht', () => {
    assert.equal(konstante('SHARE_CACHE'), SHARE_CACHE)
    assert.equal(konstante('SHARE_FILE_PREFIX'), SHARE_FILE_PREFIX)
    assert.equal(konstante('SHARE_TEXT_KEY'), SHARE_TEXT_KEY)
    assert.equal(konstante('SHARE_FILENAME_HEADER'), SHARE_FILENAME_HEADER)
    assert.equal(konstante('SHARE_LANDING'), SHARE_LANDING_PATH)
  })

  it('meldet sich nicht mehr selbst ab', () => {
    // Genau das liess alte Installationen ohne Empfänger für ihr Teilen.
    assert.ok(!worker.includes('registration.unregister'))
  })
})
