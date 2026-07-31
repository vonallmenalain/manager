/**
 * Welche Kamera der Scanner benutzt.
 *
 * Ein heutiges Telefon hat hinten drei: Weitwinkel, Ultraweitwinkel und eine,
 * die nah scharf stellt. Welche davon läuft, entscheidet sonst das System –
 * und es entscheidet beim Scannen gern um, mitten im Zielen, wenn man dem
 * Blatt näher kommt. Das Bild springt dann in Bildausschnitt und Schärfe, und
 * die Randerkennung sucht die Ecken auf einmal woanders.
 *
 * Deshalb gibt es hier eine Wahl: `null` heisst „das System entscheidet" und
 * bleibt der Standard – auf einem Gerät mit einer einzigen Kamera ist alles
 * andere Ballast. Wer das Umschalten stört, sucht sich seine Kamera einmal aus
 * und behält sie.
 */

export interface CameraOption {
  /** `deviceId` aus `enumerateDevices` – die Kennung, mit der sie sich anfordern lässt. */
  id: string
  /** Was in der Auswahl steht. */
  label: string
}

/**
 * Macht aus dem Namen, den der Browser liefert, einen lesbaren.
 *
 * Chrome auf Android schreibt „camera2 0, facing back" – eine Zeile, die aus
 * der Schnittstelle stammt und nicht für Menschen gedacht ist. iOS schreibt
 * „Back Ultra Wide Camera", und das ist im Gegenteil genau die Auskunft, die
 * man braucht: Es bleibt deshalb stehen, statt einer eigenen Benennung zu
 * weichen. Ohne Namen – solange die Kamera nicht freigegeben ist, liefert der
 * Browser keinen – bleibt die Nummer.
 */
export function cameraLabel(raw: string, index: number): string {
  const label = raw.replace(/^camera\d*\s+\d+,\s*/i, '').trim()
  if (!label) return `Kamera ${index + 1}`

  if (/^facing back$/i.test(label)) return 'Rückkamera'
  if (/^facing front$/i.test(label)) return 'Frontkamera'

  // 'HD Webcam (046d:0825)' – die Kennung in Klammern sagt niemandem etwas.
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || `Kamera ${index + 1}`
}

/**
 * Die Kameras des Geräts, benannt und unterscheidbar.
 *
 * Gleichnamige werden durchnummeriert: Auf Android heissen alle drei hinteren
 * „Rückkamera", und eine Auswahl mit dreimal demselben Eintrag wäre keine.
 * Einträge ohne Kennung fallen weg – anfordern liesse sich eine solche Kamera
 * ohnehin nicht.
 */
export function describeCameras(devices: readonly MediaDeviceInfo[]): CameraOption[] {
  const found = devices.filter((device) => device.kind === 'videoinput' && device.deviceId)
  const labels = found.map((device, index) => cameraLabel(device.label, index))

  const total = new Map<string, number>()
  for (const label of labels) total.set(label, (total.get(label) ?? 0) + 1)

  const seen = new Map<string, number>()
  return found.map((device, index) => {
    const label = labels[index] as string
    if ((total.get(label) ?? 0) === 1) return { id: device.deviceId, label }

    const number = (seen.get(label) ?? 0) + 1
    seen.set(label, number)
    return { id: device.deviceId, label: `${label} ${number}` }
  })
}

/**
 * Fragt das Gerät nach seinen Kameras.
 *
 * Erst sinnvoll, wenn die Kamera bereits läuft: Vorher gibt der Browser die
 * Namen nicht heraus – man bekäme eine Liste aus „Kamera 1", „Kamera 2",
 * „Kamera 3" und wüsste so viel wie vorher. Scheitert der Aufruf, gibt es eben
 * keine Auswahl; der Scanner läuft dann wie bisher mit der Kamera, die das
 * System aussucht.
 */
export async function listCameras(): Promise<CameraOption[]> {
  if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') return []
  try {
    return describeCameras(await navigator.mediaDevices.enumerateDevices())
  } catch {
    return []
  }
}

/**
 * Was von `getUserMedia` verlangt wird.
 *
 * `exact` und nicht `ideal`: Bei einem Wunsch dürfte das Gerät weiterhin
 * selbst entscheiden – und genau das soll die Wahl ja verhindern. Ist die
 * gemerkte Kamera nicht mehr da, scheitert die Anfrage hörbar, und der
 * Scanner fällt auf die Automatik zurück, statt stumm etwas anderes zu zeigen.
 *
 * Die hohe Wunschauflösung holt heraus, was die Kamera hergibt: A4 quer über
 * 2160 Zeilen liest die Texterkennung sicher, über 1080 nur mit Glück.
 */
export function cameraConstraints(cameraId: string | null): MediaTrackConstraints {
  const resolution = { width: { ideal: 3840 }, height: { ideal: 2160 } }
  return cameraId
    ? { deviceId: { exact: cameraId }, ...resolution }
    : // 'environment' ist die Rückkamera. Als Wunsch und nicht als Bedingung
      // formuliert: Ein Gerät mit nur einer Kamera soll die nehmen, die es
      // hat, statt die Anfrage abzulehnen.
      { facingMode: { ideal: 'environment' }, ...resolution }
}

/** Was aus dem Speicher des Geräts als Kamerawahl durchgeht. */
export function sanitizeCameraId(raw: unknown): string | null {
  return typeof raw === 'string' && raw ? raw : null
}
