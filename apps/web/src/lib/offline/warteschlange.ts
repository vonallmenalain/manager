import { useSyncExternalStore } from 'react'

import { zusammenfassen, type Auftrag, type AuftragsInhalt } from './auftraege'
import { lesen, schreiben } from './speicher'
import { istVerbindungsfehler, meldeVerbindung } from './verbindung'
import { ApiRequestError } from '../api'

/**
 * Die Warteschlange: Änderungen, die zum Server müssen.
 *
 * Alles, was an Einkaufsliste und Notizen geändert wird, kommt zuerst hier
 * hinein – mit Verbindung genauso wie ohne. Mit Verbindung ist der Auftrag
 * eine halbe Sekunde später übertragen und weg; ohne bleibt er auf dem Gerät
 * liegen, auch über einen Neustart der App, und geht, sobald der Server
 * wieder antwortet. Ein Weg statt zwei: Es gibt keinen „Offline-Modus", in
 * dem anderes gälte, und damit keinen Wechsel, bei dem etwas verloren geht.
 *
 * Gesendet wird der Reihe nach. Ein Haken auf einem Eintrag, der eben erst
 * angelegt wurde, darf nicht vor dem Anlegen ankommen.
 *
 * Was der Server ablehnt – ein Eintrag, den die andere Person inzwischen
 * gelöscht hat, eine Notiz, die es nicht mehr gibt –, wird verworfen, und
 * die Listen holen den Stand des Servers neu. Ein Auftrag, der nie durchgeht,
 * darf die Schlange nicht für immer verstopfen.
 */

const SCHLUESSEL = 'warteschlange'

/** Wie oft ein Auftrag bei einem Serverfehler (5xx) noch einmal versucht wird. */
const MAX_SERVERFEHLER = 5

/** Wartezeiten zwischen zwei Versuchen ohne Verbindung – danach jede Minute. */
const PAUSEN_MS = [3_000, 10_000, 30_000, 60_000]

export type Senden = (auftrag: Auftrag) => Promise<void>

/** Ein Auftrag, der nicht gesendet, sondern still verworfen wird. */
class Verworfen extends Error {}

export interface WarteschlangeStand {
  /** Wie viele Änderungen noch nicht beim Server sind. */
  offen: number
  /** Wird gerade übertragen? */
  sendet: boolean
  /** Eine abgelehnte Änderung – zum Anzeigen, bis sie weggeklickt wird. */
  meldung: string | null
}

let auftraege: Auftrag[] = []
/** Der Auftrag, der gerade unterwegs ist – er darf nicht mehr verändert werden. */
let unterwegs: string | null = null
let laeuft = false
let fehlversuche = 0
let serverfehler = 0
let timer: number | undefined
let meldung: string | null = null
let senden: Senden | null = null
let benutzer: () => string = () => ''
let nachDemLeeren: (() => void) | null = null
let geladen = false

let stand: WarteschlangeStand = { offen: 0, sendet: false, meldung: null }
const zuhoerer = new Set<() => void>()

function melden(): void {
  stand = { offen: auftraege.length, sendet: laeuft, meldung }
  for (const zuhoerer_ of zuhoerer) zuhoerer_()
}

function sichern(): void {
  void schreiben(SCHLUESSEL, auftraege)
}

/**
 * Lädt, was beim letzten Mal liegen blieb, und legt fest, wie gesendet wird.
 * Läuft vor dem ersten Zeichnen – die Listen zeigen die wartenden Änderungen
 * dann von Anfang an.
 */
export async function warteschlangeLaden(optionen: {
  senden: Senden
  /** Nach dem Leeren der Schlange – die Listen holen dann den Stand des Servers. */
  nachDemLeeren: () => void
  /** Wer gerade angemeldet ist – leer, solange es niemand ist. */
  benutzer: () => string
}): Promise<void> {
  senden = optionen.senden
  nachDemLeeren = optionen.nachDemLeeren
  benutzer = optionen.benutzer
  const gespeichert = await lesen<Auftrag[]>(SCHLUESSEL)
  // Was in der Zwischenzeit schon eingereiht wurde, kommt hinten dran.
  auftraege = [...(Array.isArray(gespeichert) ? gespeichert : []), ...auftraege]
  geladen = true
  melden()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void abarbeiten())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void abarbeiten()
    })
  }
  void abarbeiten()
}

/** Die wartenden Aufträge – für die Listen, die sie anwenden. */
export function offeneAuftraege(): readonly Auftrag[] {
  return auftraege
}

/** Eine Änderung einreihen. Zurück kommt der Auftrag samt Nummer und Zeit. */
export function einreihen(inhalt: AuftragsInhalt): Auftrag {
  const auftrag = {
    ...inhalt,
    nr: crypto.randomUUID(),
    zeit: new Date().toISOString(),
    benutzer: benutzer() || undefined,
  } as Auftrag
  const letzter = auftraege[auftraege.length - 1]
  const zusammen = letzter && letzter.nr !== unterwegs ? zusammenfassen(letzter, auftrag) : null
  auftraege = zusammen ? [...auftraege.slice(0, -1), zusammen] : [...auftraege, auftrag]
  sichern()
  melden()
  // Gleich losschicken; ohne Verbindung wartet der Auftrag auf das nächste Mal.
  queueMicrotask(() => void abarbeiten())
  return zusammen ?? auftrag
}

function spaeterNochmals(): void {
  window.clearTimeout(timer)
  const pause = PAUSEN_MS[Math.min(fehlversuche, PAUSEN_MS.length - 1)] as number
  fehlversuche += 1
  timer = window.setTimeout(() => void abarbeiten(), pause)
}

/** Schickt ab, was wartet – der Reihe nach, bis die Schlange leer ist oder die Verbindung fehlt. */
export async function abarbeiten(): Promise<void> {
  if (laeuft || !senden || !geladen) return
  if (auftraege.length === 0) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return

  laeuft = true
  melden()
  let gesendet = false
  try {
    while (auftraege.length > 0) {
      const auftrag = auftraege[0] as Auftrag
      unterwegs = auftrag.nr
      const jetzt = benutzer()
      try {
        // Von jemand anderem eingereiht – siehe `Auftrag.benutzer`. Still
        // verwerfen: Die Person, der er gehört, ist nicht mehr angemeldet.
        if (auftrag.benutzer && jetzt && auftrag.benutzer !== jetzt) {
          throw new Verworfen()
        }
        await senden(auftrag)
        meldeVerbindung(true)
        serverfehler = 0
      } catch (error) {
        if (!(error instanceof Verworfen) && istVerbindungsfehler(error)) {
          meldeVerbindung(false)
          spaeterNochmals()
          return
        }
        // Abgemeldet: Der Auftrag bleibt liegen, bis wieder jemand angemeldet ist.
        if (error instanceof ApiRequestError && error.status === 401) return
        if (error instanceof ApiRequestError && error.status >= 500) {
          serverfehler += 1
          if (serverfehler < MAX_SERVERFEHLER) {
            spaeterNochmals()
            return
          }
        }
        serverfehler = 0
        if (!(error instanceof Verworfen)) {
          meldung =
            error instanceof ApiRequestError
              ? `Eine Änderung wurde nicht übernommen: ${error.message}`
              : 'Eine Änderung wurde nicht übernommen.'
        }
      }
      // Übertragen oder verworfen – in beiden Fällen ist der Auftrag erledigt.
      auftraege = auftraege.filter((eintrag) => eintrag.nr !== auftrag.nr)
      unterwegs = null
      gesendet = true
      fehlversuche = 0
      sichern()
      melden()
    }
  } finally {
    unterwegs = null
    laeuft = false
    melden()
    if (gesendet && auftraege.length === 0) nachDemLeeren?.()
  }
}

/** Die Meldung über eine abgelehnte Änderung wegklicken. */
export function meldungQuittieren(): void {
  meldung = null
  melden()
}

/** Alles verwerfen – beim Abmelden. */
export function warteschlangeLeeren(): void {
  auftraege = []
  meldung = null
  window.clearTimeout(timer)
  sichern()
  melden()
}

function abonnieren(rueckruf: () => void): () => void {
  zuhoerer.add(rueckruf)
  return () => zuhoerer.delete(rueckruf)
}

/** Der Stand der Warteschlange – für den Hinweis oben und das Notizfenster. */
export function useWarteschlange(): WarteschlangeStand {
  return useSyncExternalStore(abonnieren, () => stand)
}
