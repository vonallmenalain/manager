import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cameraConstraints, cameraLabel, describeCameras, sanitizeCameraId } from './cameras.ts'

/** So viel von MediaDeviceInfo, wie describeCameras anschaut. */
function device(deviceId: string, label: string, kind: MediaDeviceKind = 'videoinput') {
  return { deviceId, label, kind, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo
}

describe('cameraLabel', () => {
  it('macht aus dem Namen von Chrome auf Android einen deutschen', () => {
    // 'camera2 0, facing back' stammt aus der Android-Schnittstelle und ist
    // nicht für Menschen gedacht.
    assert.equal(cameraLabel('camera2 0, facing back', 0), 'Rückkamera')
    assert.equal(cameraLabel('camera2 1, facing front', 1), 'Frontkamera')
  })

  it('lässt sprechende Namen stehen', () => {
    // iOS sagt genau das, was man wissen will – eine eigene Benennung wäre
    // hier ein Verlust.
    assert.equal(cameraLabel('Back Ultra Wide Camera', 0), 'Back Ultra Wide Camera')
  })

  it('wirft die Gerätekennung am Ende weg', () => {
    assert.equal(cameraLabel('HD Webcam (046d:0825)', 0), 'HD Webcam')
  })

  it('nummeriert, solange kein Name da ist', () => {
    // Vor der Freigabe der Kamera gibt der Browser keine Namen heraus.
    assert.equal(cameraLabel('', 0), 'Kamera 1')
    assert.equal(cameraLabel('   ', 2), 'Kamera 3')
  })
})

describe('describeCameras', () => {
  it('nummeriert gleichnamige Kameras durch', () => {
    // Alle drei hinteren heissen auf Android gleich – eine Auswahl mit
    // dreimal 'Rückkamera' wäre keine.
    const options = describeCameras([
      device('a', 'camera2 0, facing back'),
      device('b', 'camera2 1, facing front'),
      device('c', 'camera2 2, facing back'),
    ])

    assert.deepEqual(options, [
      { id: 'a', label: 'Rückkamera 1' },
      { id: 'b', label: 'Frontkamera' },
      { id: 'c', label: 'Rückkamera 2' },
    ])
  })

  it('lässt weg, was keine Kamera ist oder sich nicht anfordern lässt', () => {
    const options = describeCameras([
      device('a', 'Mikrofon', 'audioinput'),
      device('', 'Kamera ohne Kennung'),
      device('c', 'Back Camera'),
    ])

    assert.deepEqual(options, [{ id: 'c', label: 'Back Camera' }])
  })
})

describe('cameraConstraints', () => {
  it('verlangt eine gewählte Kamera genau, nicht bloss nach Wunsch', () => {
    // Mit 'ideal' dürfte das Gerät weiterhin selbst entscheiden – und genau
    // das soll die Wahl verhindern.
    assert.deepEqual(cameraConstraints('abc').deviceId, { exact: 'abc' })
  })

  it('wünscht sich ohne Wahl die Rückkamera', () => {
    const constraints = cameraConstraints(null)
    assert.deepEqual(constraints.facingMode, { ideal: 'environment' })
    assert.equal(constraints.deviceId, undefined)
  })
})

describe('sanitizeCameraId', () => {
  it('nimmt nur eine nicht leere Kennung an', () => {
    assert.equal(sanitizeCameraId('abc'), 'abc')
    assert.equal(sanitizeCameraId(''), null)
    assert.equal(sanitizeCameraId(42), null)
    assert.equal(sanitizeCameraId(undefined), null)
  })
})
