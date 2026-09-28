import { MAX_UPLOAD_BYTES } from '@manager/shared'

/**
 * Gewählte Dateien sofort einlesen – solange Chrome noch an sie herankommt.
 *
 * Was die Auswahl des Systems zurückgibt, ist zunächst nur ein Verweis auf die
 * Datei; gelesen wird sie erst beim Hochladen. Bei Dateien aus Google Drive
 * geht das auf Android schief, auf zwei Arten:
 *
 *  - Drive lädt die Datei kurz nach der Auswahl nach und ändert sie dabei.
 *    Chrome bemerkt die Änderung beim späteren Hochladen und bricht ab
 *    (ERR_UPLOAD_FILE_CHANGED) – etwa wenn vorher noch Titel und Status
 *    gewählt werden.
 *  - Liegt die Datei nur in Drive und nicht auf dem Gerät, kommt Chrome gar
 *    nicht an ihren Inhalt heran.
 *
 * Beides sah in der App aus wie ein Verbindungsfehler („Keine Verbindung zum
 * Server. Bist du offline?"), obwohl die Verbindung stand.
 *
 * Deshalb wird jede gewählte Datei gleich nach der Auswahl in den
 * Arbeitsspeicher kopiert. Danach hängt nichts mehr an Drive, und es spielt
 * keine Rolle, wie lange das Ausfüllen dauert. Was sich nicht lesen lässt,
 * kommt mit einem Satz zurück, der sagt, was stattdessen geht.
 */

/** Eine Datei, eingelesen – oder der Grund, warum nicht. */
export type Einlesung = { ok: true; datei: File } | { ok: false; meldung: string }

export interface Eingelesen {
  /** Die lesbaren Dateien, jetzt im Arbeitsspeicher – in der gewählten Reihenfolge. */
  dateien: File[]
  /** Für jede Datei, die sich nicht lesen liess, ein Satz dazu. */
  probleme: string[]
}

/**
 * Wie viel eine Auswahl zusammen in den Arbeitsspeicher holen darf.
 *
 * Jede Datei darf bis zu 50 MB gross sein, und fast überall lassen sich
 * mehrere zugleich wählen. Ohne Obergrenze lägen zehn grosse PDFs mit einer
 * halben Milliarde Bytes im Speicher, bevor die erste hochgeladen ist – auf
 * dem Handy das Ende des Tabs. Zwei Dateien der Höchstgrösse passen hinein,
 * eine übliche Auswahl von Fotos und Briefen bei Weitem.
 */
export const MAX_AUSWAHL_BYTES = 2 * MAX_UPLOAD_BYTES

/** Mehrere Dateien einlesen – getrennt nach Lesbarem und Problemen. */
export async function einlesen(files: readonly File[]): Promise<Eingelesen> {
  const dateien: File[] = []
  const probleme: string[] = []
  for (const ergebnis of await einlesenEinzeln(files)) {
    if (ergebnis.ok) dateien.push(ergebnis.datei)
    else probleme.push(ergebnis.meldung)
  }
  return { dateien, probleme }
}

/**
 * Mehrere Dateien einlesen – jede mit ihrem Ergebnis, in der gewählten
 * Reihenfolge.
 *
 * Eine nach der anderen, nicht alle zugleich: So liegt jeweils nur eine Datei
 * doppelt im Speicher (als gelesener Puffer und als neue Datei). „Sofort"
 * bleibt es trotzdem – eine Datei vom Gerät ist in einem Augenblick gelesen,
 * und eine, an die Chrome nicht herankommt, scheitert ebenso schnell.
 */
export async function einlesenEinzeln(files: readonly File[]): Promise<Einlesung[]> {
  const ergebnisse: Einlesung[] = []
  let summe = 0
  for (const file of files) {
    // Eine einzelne zu grosse Datei meldet `dateiEinlesen` selbst, genauer.
    if (file.size <= MAX_UPLOAD_BYTES && summe + file.size > MAX_AUSWAHL_BYTES) {
      ergebnisse.push({ ok: false, meldung: meldungZuViel(file.name) })
      continue
    }
    const ergebnis = await dateiEinlesen(file)
    if (ergebnis.ok) summe += file.size
    ergebnisse.push(ergebnis)
  }
  return ergebnisse
}

export async function dateiEinlesen(file: File): Promise<Einlesung> {
  // Was der Server ohnehin ablehnt, muss nicht erst in den Speicher.
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      meldung: `„${file.name}" ist grösser als ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    }
  }

  let inhalt: ArrayBuffer
  try {
    inhalt = await file.arrayBuffer()
  } catch {
    return { ok: false, meldung: meldungUnlesbar(file.name) }
  }

  // Leer heisst hier fast immer: Die Ablage hat den Inhalt nicht herausgegeben.
  if (inhalt.byteLength === 0) return { ok: false, meldung: meldungUnlesbar(file.name) }

  return {
    ok: true,
    datei: new File([inhalt], file.name, { type: file.type, lastModified: file.lastModified }),
  }
}

function meldungZuViel(name: string): string {
  return `„${name}" wurde nicht gelesen – die Auswahl ist zusammen grösser als ${Math.round(MAX_AUSWAHL_BYTES / 1024 / 1024)} MB. Bitte in kleineren Portionen wählen.`
}

/** Was zu tun ist, wenn Chrome eine Datei nicht lesen kann. */
export function meldungUnlesbar(name: string): string {
  return `„${name}" liess sich nicht lesen. Liegt die Datei in Google Drive: dort zuerst herunterladen (⋮ → Herunterladen) und dann hier aus „Downloads" wählen.`
}

/**
 * Die erste Datei eines Formulars, die sich nicht (mehr) lesen lässt.
 *
 * Für ein Hochladen, das ohne Antwort abbricht: Lag es an der Datei, soll die
 * Meldung das sagen, statt nach der Verbindung zu fragen. Ein Byte genügt –
 * Chrome prüft beim Lesen jedes Stücks, ob die Datei noch dieselbe ist.
 */
export async function unlesbareDatei(body: FormData): Promise<File | null> {
  for (const [, wert] of body.entries()) {
    if (typeof wert === 'string') continue
    try {
      await wert.slice(0, 1).arrayBuffer()
    } catch {
      return wert
    }
  }
  return null
}
