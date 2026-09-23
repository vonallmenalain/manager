/**
 * Die Steuern in der Sprache der vorigen App-Version.
 *
 * Bis zu den Steuerjahren kannte ein Jahr genau einen Steuerbetrag: gelesen
 * aus `settings.taxCents`, gespeichert über `PUT …/einstellungen`, und eine
 * Zahlung verrechnete nur das Guthaben ihres eigenen Jahres. Seither hat ein
 * Jahr beliebig viele Einträge mit Bezeichnung, und eine Zahlung sagt, aus
 * welchem Steuerjahr ihr Guthaben stammt.
 *
 * Der Server ist nach einem Merge nach wenigen Minuten in Betrieb, die App
 * erst, wenn sie veröffentlicht ist und das Telefon ihren neuen Programmtext
 * geholt hat. Bis dahin fragt eine alte App den neuen Server – und fände sie
 * `settings` nicht mehr, bräche ihr Fenster „Steuern" ab, statt den Betrag
 * zu zeigen.
 *
 * Der Server spricht deshalb beide Sprachen, an drei Stellen:
 *
 *  - Die Antwort trägt weiter `settings.taxCents`, die Summe des Jahres.
 *  - `PUT …/einstellungen` setzt den einen Betrag (`legacyTaxEntries`).
 *  - Eine Zahlung ohne `taxYears` verrechnet aus dem eigenen Jahr, wie
 *    früher (`taxYearsOfPayment`).
 *
 * Wenn auf keinem Telefon mehr eine App von vor den Steuerjahren liegt, kann
 * diese Datei samt den drei Stellen ersatzlos weg.
 */
import { z } from 'zod'

/** Was eine alte App beim Speichern ihrer Steuern schickt. */
export const legacySettingsSchema = z.object({
  taxCents: z.number().int().min(0).max(100_000_000),
})

/**
 * Die Einträge eines Jahres, nachdem eine alte App seinen Steuerbetrag
 * gespeichert hat.
 *
 * `'unverändert'`, wenn die Summe schon stimmt – dann gibt es nichts zu
 * schreiben. `'mehrdeutig'`, wenn das Jahr mehrere Einträge hat: Welcher sich
 * ändern soll, weiss eine App nicht, die nur die Summe kennt, und jede
 * Vermutung würde überschreiben, was jemand in der neuen App bewusst aufgeteilt
 * hat. Abweisen hilft dort auch nicht: Die alte App versucht ein
 * fehlgeschlagenes Speichern ohne Pause gleich wieder.
 */
export function legacyTaxEntries(
  existing: readonly { label: string; amountCents: number }[],
  taxCents: number,
): { label: string; amountCents: number }[] | 'unverändert' | 'mehrdeutig' {
  const sum = existing.reduce((total, entry) => total + entry.amountCents, 0)
  if (sum === taxCents) return 'unverändert'
  if (existing.length > 1) return 'mehrdeutig'

  // Eine 0 hiess in der alten App „keine Steuern" – ein Eintrag über 0 wäre
  // eine Zeile, die niemand angelegt hat.
  if (taxCents === 0) return []
  return [{ label: existing[0]?.label ?? '', amountCents: taxCents }]
}

/**
 * Aus welchen Steuerjahren eine Zahlung verrechnet. Eine alte App schickt
 * keine: Sie kannte nur die Steuern des Jahres, in dem sie die Zahlung
 * erfasst – und genau dieses Guthaben hat sie auch angezeigt und gedeckelt.
 */
export function taxYearsOfPayment(taxYears: number[] | undefined, year: number): number[] {
  return taxYears ?? [year]
}
