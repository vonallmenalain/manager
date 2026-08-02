/**
 * Aus einem geteilten Text eine Notiz machen.
 *
 * Was Android beim Teilen mitschickt, ist von App zu App verschieden: Chrome
 * legt den Seitentitel in `title` und die Adresse in `text`, andere füllen
 * `url`, wieder andere schicken nur eine Zeile markierten Text. Alle drei
 * Felder dürfen leer sein, keines ist verlässlich.
 *
 * Deshalb steht die Zusammenstellung hier als reine Funktion und nicht in der
 * Oberfläche: So lässt sich jede dieser Spielarten prüfen, ohne ein Handy in
 * die Hand zu nehmen (siehe shareNote.test.ts).
 */
// Ohne Import aus @manager/shared: Diese Datei läuft in `node --test` direkt,
// ohne gebautes Paket daneben.

/** Grenzen aus `upsertNoteSchema` – der Server nimmt nichts Längeres an. */
const TITEL_MAX = 120
const TEXT_MAX = 20_000

export interface SharedText {
  title: string
  text: string
  url: string
}

export interface NoteDraft {
  title: string
  body: string
}

/**
 * Titel und Text der Notiz, die aus dem Geteilten entsteht.
 *
 * Der Verweis bleibt im Text stehen und wird nicht in den Titel gehoben: In
 * der Notiz ist er dort anklickbar, im Titel wäre er nur eine lange Zeile.
 */
export function noteFromShare(shared: Partial<SharedText>): NoteDraft {
  const title = (shared.title ?? '').trim()
  const text = (shared.text ?? '').trim()
  const url = (shared.url ?? '').trim()

  const zeilen: string[] = []

  // Viele Apps schicken den Seitentitel zusätzlich als Text. Ihn ein zweites
  // Mal in den Text zu schreiben, sähe nach einem Fehler aus.
  if (text && text !== title) zeilen.push(text)

  // Dasselbe für die Adresse: Chrome schickt sie oft in `text` und `url`.
  if (url && !zeilen.some((zeile) => zeile.includes(url))) zeilen.push(url)

  const body = zeilen.join('\n').slice(0, TEXT_MAX)

  return {
    title: (title || titelAusText(body)).slice(0, TITEL_MAX),
    body,
  }
}

/** Ist überhaupt etwas dabei, aus dem eine Notiz werden kann? */
export function hatText(shared: Partial<SharedText>): boolean {
  const draft = noteFromShare(shared)
  return draft.title !== '' || draft.body !== ''
}

/**
 * Ein Titel für ein Teilen, das keinen mitbringt.
 *
 * Besteht das Geteilte nur aus einer Adresse, nimmt der Titel deren Gastgeber
 * – „srf.ch" sagt in der Übersicht mehr als eine Zeile voller Parameter. Sonst
 * bleibt der Titel leer: Die erste Textzeile stünde dann zweimal da, einmal
 * als Titel und einmal als Text.
 */
function titelAusText(body: string): string {
  const zeilen = body.split('\n').filter((zeile) => zeile.trim() !== '')
  if (zeilen.length !== 1) return ''

  const host = hostAus(zeilen[0] as string)
  return host ?? ''
}

/** Der Gastgeber einer Adresse, ohne `www.` – oder nichts, wenn es keine ist. */
function hostAus(zeile: string): string | null {
  const roh = zeile.trim()
  if (roh.includes(' ')) return null

  const mitSchema = /^https?:\/\//i.test(roh) ? roh : `https://${roh}`
  try {
    const { hostname } = new URL(mitSchema)
    // Ohne Punkt ist es kein Gastgeber, sondern ein einzelnes Wort.
    if (!hostname.includes('.')) return null
    return hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}
