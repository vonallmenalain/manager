import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DOCBASE_SCOPE,
  MANAGER_BASENAME,
  MANAGER_SCOPE,
  scopesUeberschneidenSich,
} from './appScopes.ts'
import { SHARE_TARGET_PATH } from './shareConstants.ts'

/**
 * Diese Prüfungen sichern die Bedingung, an der die zweite App einmal
 * gescheitert ist: Zwei PWAs auf einer Adresse lassen sich nur installieren,
 * solange keiner der beiden Geltungsbereiche im anderen liegt. Der Fehler
 * fällt sonst nirgends auf – nicht beim Bauen, nicht im Browser, erst beim
 * Installieren auf dem Handy.
 */
describe('Geltungsbereiche der beiden Apps', () => {
  it('liegen nebeneinander, nicht ineinander', () => {
    assert.equal(
      scopesUeberschneidenSich(MANAGER_SCOPE, DOCBASE_SCOPE),
      false,
      `${MANAGER_SCOPE} und ${DOCBASE_SCOPE} überschneiden sich – Android hielte beide für dieselbe App`,
    )
  })

  it('beanspruchen nicht die Wurzel', () => {
    // Die Wurzel enthält jede andere Adresse. Eine App dort wäre automatisch
    // der Bereich, in dem die andere liegt.
    for (const scope of [MANAGER_SCOPE, DOCBASE_SCOPE]) {
      assert.notEqual(scope, '/', 'Eine App auf / umschliesst die jeweils andere')
    }
  })

  it('enden mit einem Schrägstrich', () => {
    // Ohne ihn ist `/app` auch ein Präfix von `/appetit` – und die Adresse
    // ohne Schrägstrich gälte dem Browser als ausserhalb der App.
    for (const scope of [MANAGER_SCOPE, DOCBASE_SCOPE]) {
      assert.ok(scope.endsWith('/'), `${scope} braucht einen Schrägstrich am Ende`)
    }
  })

  it('tragen das Teilen-Ziel des Managers in dessen Bereich', () => {
    // Ein Teilen-Ziel ausserhalb des eigenen Bereichs lehnt der Browser ab;
    // die App verschwände wortlos aus dem Teilen-Menü von Android.
    assert.ok(
      SHARE_TARGET_PATH.startsWith(MANAGER_SCOPE),
      `${SHARE_TARGET_PATH} liegt ausserhalb von ${MANAGER_SCOPE}`,
    )
  })

  it('geben dem Router dieselbe Adresse ohne Schrägstrich', () => {
    assert.equal(`${MANAGER_BASENAME}/`, MANAGER_SCOPE)
  })
})
