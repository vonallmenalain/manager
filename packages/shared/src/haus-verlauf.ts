import { COST_GROUPS, type CostGroupCents, type Division, type DivisionEntry } from './haus.js'

/**
 * Der Jahresverlauf im Bereich Haus: Rechnungen auf Tage und Monate verteilt.
 *
 * Eine Abrechnung deckt ein halbes oder ein ganzes Jahr. Wer ein einzelnes Jahr
 * anschaut, sieht so nur eine Säule – und weiss nicht, welche Monate schon
 * abgerechnet sind, welche erst mit Akonto vorausbezahlt und welche noch offen.
 * Hier wird deshalb jede Rechnung gleichmässig auf die Tage ihrer Periode
 * verteilt. Gleichmässig, weil die Rechnung nicht feiner sagt, wann verbraucht
 * wurde: Ein Wintermonat bekommt denselben Anteil wie ein Sommermonat, und
 * die Oberfläche sagt das dazu.
 *
 * Akontorechnungen zählen nur für die Tage, die noch keine Abrechnung derselben
 * Sparte deckt. Sind sie abgerechnet, sind sie in der Abrechnung aufgegangen –
 * daneben gezählt verdoppelten sie die Kosten.
 */

const TAG = 86_400_000

function ms(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

function isoAus(zeit: number): string {
  return new Date(zeit).toISOString().slice(0, 10)
}

function plusTage(iso: string, tage: number): string {
  return isoAus(ms(iso) + tage * TAG)
}

/** Tage von `von` bis `bis`, beide mitgezählt. */
function tageZwischen(von: string, bis: string): number {
  return Math.round((ms(bis) - ms(von)) / TAG) + 1
}

export interface Zeitspanne {
  /** Erster Tag, mitgezählt. */
  von: string
  /** Letzter Tag, mitgezählt. */
  bis: string
}

/**
 * Der Teil eines Eintrags, der in die Spanne fällt.
 *
 * Kosten, Mengen und Blöcke werden nach Tagen geteilt; Preis je Einheit und
 * Werte je Tag bleiben, wie sie sind – bei gleichmässiger Verteilung gelten
 * sie für jeden Tag der Periode. Die Beträge bleiben ungerundet: Zwölf
 * gerundete Monate ergäben zusammen nicht wieder die Rechnung.
 */
export function proRata(entry: DivisionEntry, von: string, bis: string): DivisionEntry | null {
  const anfang = entry.bill.periodStart > von ? entry.bill.periodStart : von
  const ende = entry.bill.periodEnd < bis ? entry.bill.periodEnd : bis
  if (anfang > ende || entry.days <= 0) return null

  const tage = tageZwischen(anfang, ende)
  const anteil = tage / entry.days
  const skaliert = (wert: number | null): number | null => (wert === null ? null : wert * anteil)
  const gruppen = entry.groupCents

  return {
    ...entry,
    id: `${entry.id}@${anfang}`,
    bill: { ...entry.bill, periodStart: anfang, periodEnd: ende },
    days: tage,
    quantity: skaliert(entry.quantity),
    highQuantity: skaliert(entry.highQuantity),
    lowQuantity: skaliert(entry.lowQuantity),
    costCents: entry.costCents * anteil,
    groupCents: gruppen
      ? (Object.fromEntries(COST_GROUPS.map((group) => [group, gruppen[group] * anteil])) as CostGroupCents)
      : null,
  }
}

/** Die Tage einer Spanne, die keine der Deckungen erfasst – als lückenlose Stücke. */
export function ungedeckt(spanne: Zeitspanne, deckungen: readonly Zeitspanne[]): Zeitspanne[] {
  const stuecke: Zeitspanne[] = []
  let ab = spanne.von

  for (const deckung of [...deckungen].sort((a, b) => a.von.localeCompare(b.von))) {
    if (ab > spanne.bis) break
    if (deckung.bis < ab) continue
    if (deckung.von > spanne.bis) break
    if (deckung.von > ab) stuecke.push({ von: ab, bis: plusTage(deckung.von, -1) })
    const danach = plusTage(deckung.bis, 1)
    if (danach > ab) ab = danach
  }
  if (ab <= spanne.bis) stuecke.push({ von: ab, bis: spanne.bis })
  return stuecke
}

const periodeVon = (entry: DivisionEntry): Zeitspanne => ({
  von: entry.bill.periodStart,
  bis: entry.bill.periodEnd,
})

/**
 * Was von den Akontorechnungen noch provisorisch ist: ihre Tage, die keine
 * Abrechnung derselben Sparte deckt – anteilig, als eigene Einträge.
 */
export function offenesAkonto(
  akonto: readonly DivisionEntry[],
  abrechnungen: readonly DivisionEntry[],
): DivisionEntry[] {
  return akonto.flatMap((entry) => {
    const deckungen = abrechnungen.filter((a) => a.division === entry.division).map(periodeVon)
    return ungedeckt(periodeVon(entry), deckungen)
      .map((stueck) => proRata(entry, stueck.von, stueck.bis))
      .filter((teil): teil is DivisionEntry => teil !== null)
  })
}

export interface Monat {
  /** 1 bis 12. */
  month: number
  von: string
  bis: string
  tage: number
  /** Die Abrechnungen, anteilig auf die Tage dieses Monats. */
  entries: DivisionEntry[]
  /** Akonto, soweit diese Tage noch keine Abrechnung deckt – provisorisch. */
  akonto: DivisionEntry[]
}

/** Die zwölf Monate eines Jahres mit dem, was in sie fällt. */
export function monateDesJahres(
  year: number,
  abrechnungen: readonly DivisionEntry[],
  akontoOffen: readonly DivisionEntry[],
): Monat[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const von = `${year}-${String(month).padStart(2, '0')}-01`
    const bis = plusTage(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`, -1)
    const teile = (liste: readonly DivisionEntry[]) =>
      liste.map((entry) => proRata(entry, von, bis)).filter((teil): teil is DivisionEntry => teil !== null)
    return { month, von, bis, tage: tageZwischen(von, bis), entries: teile(abrechnungen), akonto: teile(akontoOffen) }
  })
}

export interface MonatsStand {
  month: number
  tage: number
  /** Tage, die eine Abrechnung deckt. */
  abgerechnet: number
  /** Tage, die nur eine Akontorechnung deckt. */
  akonto: number
}

/**
 * Je Sparte und Monat: wie viele Tage abgerechnet sind, wie viele erst mit
 * Akonto vorausbezahlt und wie viele noch gar nicht.
 */
export function abrechnungsstand(
  monate: readonly Monat[],
  divisions: readonly Division[],
): { division: Division; monate: MonatsStand[] }[] {
  const gedeckt = (spanne: Zeitspanne, eintraege: readonly DivisionEntry[]) =>
    tageZwischen(spanne.von, spanne.bis) -
    ungedeckt(spanne, eintraege.map(periodeVon)).reduce((sum, stueck) => sum + tageZwischen(stueck.von, stueck.bis), 0)

  return divisions.map((division) => ({
    division,
    monate: monate.map((monat) => {
      const spanne = { von: monat.von, bis: monat.bis }
      const abgerechnet = gedeckt(spanne, monat.entries.filter((entry) => entry.division === division))
      const akonto = gedeckt(spanne, monat.akonto.filter((entry) => entry.division === division))
      return { month: monat.month, tage: monat.tage, abgerechnet, akonto: Math.min(akonto, monat.tage - abgerechnet) }
    }),
  }))
}

/** Dasselbe Datum ein Jahr früher; der 29. Februar wird zum 28. */
function einJahrFrueher(iso: string): string {
  const [jahr, monat, tag] = iso.split('-')
  const kandidat = `${Number(jahr) - 1}-${monat}-${tag}`
  return isoAus(ms(kandidat)) === kandidat ? kandidat : `${Number(jahr) - 1}-${monat}-28`
}

export interface Vergleichszeitraum {
  /** Die Abrechnungen des Vorjahres, zugeschnitten auf dieselben Tage. */
  entries: DivisionEntry[]
  von: string
  bis: string
}

/**
 * Dieselben Tage ein Jahr früher – der ehrliche Vergleich für ein angefangenes Jahr.
 *
 * Liegt für 2026 erst das erste Halbjahr vor, ist das ganze Jahr 2025 kein
 * Vergleich: „−48 %" wäre eine Aussage über die Zahl der Rechnungen. Für
 * jeden gewählten Eintrag wird deshalb seine Periode um ein Jahr
 * zurückgeschoben und aus den Abrechnungen derselben Sparte anteilig
 * herausgeschnitten.
 *
 * null, wenn das Vorjahr diese Tage nicht so gut wie vollständig deckt –
 * ein halber Vergleich wäre schlechter als keiner.
 */
export function gleicherZeitraumVorjahr(
  gewaehlt: readonly DivisionEntry[],
  alle: readonly DivisionEntry[],
): Vergleichszeitraum | null {
  if (gewaehlt.length === 0) return null

  const entries: DivisionEntry[] = []
  let von: string | null = null
  let bis: string | null = null

  for (const entry of gewaehlt) {
    const spanne = {
      von: einJahrFrueher(entry.bill.periodStart),
      bis: einJahrFrueher(entry.bill.periodEnd),
    }
    const teile = alle
      .filter((kandidat) => kandidat.division === entry.division && kandidat.id !== entry.id)
      .map((kandidat) => proRata(kandidat, spanne.von, spanne.bis))
      .filter((teil): teil is DivisionEntry => teil !== null)

    const gedeckt = teile.reduce((sum, teil) => sum + teil.days, 0)
    // Ablesetage verschieben sich von Jahr zu Jahr um ein paar Tage.
    if (gedeckt < tageZwischen(spanne.von, spanne.bis) * 0.97) return null

    entries.push(...teile)
    if (von === null || spanne.von < von) von = spanne.von
    if (bis === null || spanne.bis > bis) bis = spanne.bis
  }

  return von !== null && bis !== null ? { entries, von, bis } : null
}

const KURZE_MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'] as const

/** „Jan" für 1 – für die Achse eines Diagramms. */
export function kurzerMonat(month: number): string {
  return KURZE_MONATE[month - 1] ?? String(month)
}

/**
 * Ein Zeitraum in der Kürze, die eine Kachel hergibt: „2025", „Jan–Jun 2025",
 * „Mär 2025" – und wo er nicht an Monatsgrenzen liegt, „03.01.–30.06.2025".
 */
export function kurzerZeitraum(von: string, bis: string): string {
  const [vonJahr, vonMonat, vonTag] = von.split('-').map(Number)
  const [bisJahr, bisMonat] = bis.split('-').map(Number)
  const monatsEnde = plusTage(bis, 1).endsWith('-01')

  if (vonTag === 1 && monatsEnde && vonJahr !== undefined && vonMonat !== undefined && bisMonat !== undefined) {
    if (vonJahr === bisJahr) {
      if (vonMonat === 1 && bisMonat === 12) return String(vonJahr)
      if (vonMonat === bisMonat) return `${kurzerMonat(vonMonat)} ${vonJahr}`
      return `${kurzerMonat(vonMonat)}–${kurzerMonat(bisMonat)} ${vonJahr}`
    }
    return `${kurzerMonat(vonMonat)} ${vonJahr} – ${kurzerMonat(bisMonat)} ${bisJahr}`
  }

  const [, vm = '', vt = ''] = von.split('-')
  const [bj = '', bm = '', bt = ''] = bis.split('-')
  return vonJahr === bisJahr ? `${vt}.${vm}.–${bt}.${bm}.${bj}` : `${vt}.${vm}.${vonJahr} – ${bt}.${bm}.${bj}`
}
