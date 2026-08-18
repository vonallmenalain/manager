import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseUtilityInvoice } from './haus-parser.ts'
import type { PdfLine } from './pdf-text.ts'

/**
 * Die Zeilen einer Rechnung, wie `pdf-text` sie liefert: je Eintrag eine Zeile,
 * die Zellen durch `|` getrennt. Absichtlich abgeschrieben von den echten
 * Rechnungen der Energie- und Wasserversorgung Oberburg – samt der Eigenheit,
 * dass mal der gerade und mal der typografische Apostroph als
 * Tausendertrennzeichen erscheint.
 */
function lines(rows: string[], page = 1): PdfLine[] {
  return rows.map((row, index) => {
    const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean)
    return { page, y: 800 - index * 13, cells, text: cells.join(' ') }
  })
}

// ------------------------------------------------------------------- Strom

const STROM_KOPF = [
  'Kundennummer: | 18444 / 4086',
  'Rechnungsdatum: | 23.01.2025',
  'Abrechnung Nr. 231125 | Betrag CHF',
  'Elektrizität',
  'Periode vom 01.07.2024 - 31.12.2024',
  'Energie | 1’090.15',
  'Netznutzung | 750.80',
  'Gesetzliche Abgaben und Förderbeiträge | 321.10',
  'Zwischentotal | 2’162.05',
  'Akontoabzug | -620.00',
  'Rechnungsbetrag inkl. MWST | 1’542.05',
  'CHE-110.349.410 MWST CHF 115.50 (inkl. 8.10% von CHF 1’542.05)',
]

const STROM_DETAIL = [
  'Elektrizität',
  'Messpunkt: CH1071601234500000000000000000919',
  'Verbrauchsermittlung | Messperiode | Zähler Nr. | Stand alt | Stand neu | Faktor | Menge',
  "Wirkstrom Hochtarif | 27.06.2024 | - | 28.06.2024 | 3760 | 22'796 | 22'796 | 0 | kWh",
  "28.06.2024 | - | 20.01.2025 | 22'796 | 26'082 | 3'286 | kWh",
  "Wirkstrom Niedertarif | 28.06.2024 | - | 20.01.2025 | 27'441 | 29'606 | 2'165 | kWh",
  'Betragsermittlung | Menge | Ansatz | Dauer | exkl. MWST | Satz | inkl. MWST',
  'Energie ewo Haushalt',
  "Wirkstrom Hochtarif | 3'286 | kWh | 18.50 | Rp. | 607.90 | 8.10 | 657.15",
  "Wirkstrom Niedertarif | 2'165 | kWh | 18.50 | Rp. | 400.55 | 8.10 | 433.00",
  "Total Energie | 1'090.15",
  'Netznutzung NS Haushalt',
  "Netz Hochtarif | 3'286 | kWh | 12.20 | Rp. | 400.90 | 8.10 | 433.35",
  'Grundpreis | 1 | 12.50 | Fr. | 6 Mt. | 75.00 | 8.10 | 81.10',
  'Total Netznutzung | 750.80',
  'Netznutzung NS Haushalt',
  "Abgaben Gemeinwesen | 5'451 | kWh | 1.20 | Rp. | 65.40 | 8.10 | 70.70",
  'Total Gesetzliche Abgaben und Förderbeiträge | 321.10',
]

function stromrechnung(): PdfLine[] {
  return [...lines(STROM_KOPF, 1), ...lines(STROM_DETAIL, 2)]
}

describe('parseUtilityInvoice – Stromrechnung', () => {
  it('liest Kopfdaten und Beträge ohne Hinweise', () => {
    const { bill, hinweise } = parseUtilityInvoice(stromrechnung(), 'strom.pdf')

    assert.deepEqual(hinweise, [])
    assert.ok(bill)
    assert.equal(bill.kind, 'abrechnung')
    assert.equal(bill.invoiceNumber, '231125')
    assert.equal(bill.invoiceDate, '2025-01-23')
    assert.equal(bill.periodStart, '2024-07-01')
    assert.equal(bill.periodEnd, '2024-12-31')
    assert.equal(bill.subtotalCents, 216_205)
    assert.equal(bill.prepaidCents, 62_000)
    assert.equal(bill.totalCents, 154_205)
    assert.equal(bill.vatCents, 11_550)
  })

  it('legt genau eine Sparte an und füllt ihre drei Blöcke', () => {
    const { bill } = parseUtilityInvoice(stromrechnung())

    assert.equal(bill?.sections.length, 1)
    const strom = bill?.sections[0]
    assert.equal(strom?.division, 'strom')
    // Das Total der Sparte ist die Summe der Blöcke, nicht der Rechnungsbetrag.
    assert.equal(strom?.amountCents, 216_205)
    assert.deepEqual(strom?.groups, [
      { group: 'energie', amountCents: 109_015 },
      { group: 'netznutzung', amountCents: 75_080 },
      { group: 'abgaben', amountCents: 32_110 },
    ])
    assert.equal(strom?.meterPoint, 'CH1071601234500000000000000000919')
    assert.equal(strom?.meterNumber, '3760')
  })

  it('summiert den Verbrauch über einen Zählerwechsel hinweg', () => {
    const { bill } = parseUtilityInvoice(stromrechnung())

    // Der Hochtarif steht in zwei Zeilen: 0 kWh bis zum Wechsel, 3'286 danach.
    assert.deepEqual(bill?.sections[0]?.readings, [
      {
        tariff: 'hoch',
        label: 'Wirkstrom Hochtarif',
        unit: 'kWh',
        startValue: 22_796,
        endValue: 26_082,
        quantity: 3286,
      },
      {
        tariff: 'nieder',
        label: 'Wirkstrom Niedertarif',
        unit: 'kWh',
        startValue: 27_441,
        endValue: 29_606,
        quantity: 2165,
      },
    ])
  })

  it('ordnet die Positionen ihrem Block zu, obwohl die Überschrift zweimal gleich heisst', () => {
    const { bill } = parseUtilityInvoice(stromrechnung())
    const zuordnung = bill?.sections[0]?.positions.map((p) => `${p.group}:${p.label}`)

    assert.deepEqual(zuordnung, [
      'energie:Wirkstrom Hochtarif',
      'energie:Wirkstrom Niedertarif',
      'netznutzung:Netz Hochtarif',
      'netznutzung:Grundpreis',
      'abgaben:Abgaben Gemeinwesen',
    ])
  })

  it('kommt mit dem Grundpreis zurecht, der eine Spalte weniger belegt', () => {
    const { bill } = parseUtilityInvoice(stromrechnung())
    const grundpreis = bill?.sections[0]?.positions.find((p) => p.label === 'Grundpreis')

    assert.equal(grundpreis?.quantity, 1)
    assert.equal(grundpreis?.rateHundredths, 1250)
    assert.equal(grundpreis?.rateUnit, 'Fr.')
    assert.equal(grundpreis?.durationMonths, 6)
    assert.equal(grundpreis?.grossCents, 8110)
  })
})

// ------------------------------------------- Stromrechnung im Aufbau ab 2026

/**
 * Dieselbe Rechnung, wie der Versorger sie seit 2026 stellt – abgeschrieben
 * von der Abrechnung 248'619 für das erste Halbjahr 2026.
 *
 * Zwei Dinge haben sich geändert, und beide brachten den Import zu Fall: Die
 * „Messung" ist ein eigener Block neben Energie, Netznutzung und Abgaben, und
 * die beiden Tarife heissen nicht mehr Hoch- und Niedertarif, sondern Tag- und
 * Nachttarif.
 */
const STROM_2026_KOPF = [
  'Kundennummer: | 18444 / 4086',
  'Rechnungsdatum: | 14.07.2026',
  'Abrechnung Nr. 248619 | Betrag CHF',
  'Elektrizität',
  'Periode vom 01.01.2026 - 30.06.2026',
  'Energie | 854.90',
  'Netznutzung | 697.85',
  'Gesetzliche Abgaben und Förderbeiträge | 238.65',
  'Messung | 42.15',
  "Zwischentotal | 1'833.55",
  'Akontoabzug | -870.00',
  'Rechnungsbetrag inkl. MWST | 963.55',
  'CHE-110.349.410 MWST CHF 72.10 (inkl. 8.10% von CHF 963.55)',
]

const STROM_2026_DETAIL = [
  'Elektrizität',
  'Messpunkt: CH1071601234500000000000000000919',
  'Verbrauchsermittlung | Messperiode | Zähler Nr. | Stand alt | Stand neu | Faktor | Menge',
  "Wirkstrom Tagtarif | 06.01.2026 | - | 06.07.2026 | 3760 | 31'185 | 33'945 | 2'760 | kWh",
  "Wirkstrom Nachttarif | 06.01.2026 | - | 06.07.2026 | 34'093 | 36'553 | 2'460 | kWh",
  'Betragsermittlung | Menge | Ansatz | Dauer | exkl. MWST | Satz | inkl. MWST',
  'Energielieferung Tarif Haushalt',
  "Arbeitspreis Einheitstarif | 5'220 | kWh | 15.15 | Rp. | 790.85 | 8.10 | 854.90",
  'Total Energie | 854.90',
  'Netznutzung Tarif Haushalt',
  "Arbeitspreis Tagtarif | 2'760 | kWh | 10.20 | Rp. | 281.50 | 8.10 | 304.30",
  "Arbeitspreis Nachttarif | 2'460 | kWh | 11.75 | Rp. | 289.05 | 8.10 | 312.45",
  'Grundpreis | 1 | 12.50 | Fr. | 6 Mt. | 75.00 | 8.10 | 81.10',
  'Total Netznutzung | 697.85',
  'Gesetzliche Abgaben und Förderbeiträge',
  "Gemeindeabgabe | 5'220 | kWh | 1.20 | Rp. | 62.65 | 8.10 | 67.70",
  "Systemdienstleistungen (SDL) | 5'220 | kWh | 0.27 | Rp. | 14.10 | 8.10 | 15.25",
  "Stromreserve Bund | 5'220 | kWh | 0.41 | Rp. | 21.40 | 8.10 | 23.15",
  "Netzzuschlag | 5'220 | kWh | 2.30 | Rp. | 120.05 | 8.10 | 129.75",
  "Solidarisierte Kosten | 5'220 | kWh | 0.05 | Rp. | 2.60 | 8.10 | 2.80",
  'Total Gesetzliche Abgaben und Förderbeiträge | 238.65',
  'Messung',
  'Messung | 1 | 6.50 | Fr. | 6 Mt. | 39.00 | 8.10 | 42.15',
  'Total Messung | 42.15',
  "Zwischentotal | 1'833.55",
  'Akontoabzug | -870.00',
  'Total Objekt | 963.55',
]

function stromrechnung2026(): PdfLine[] {
  return [...lines(STROM_2026_KOPF, 1), ...lines(STROM_2026_DETAIL, 2)]
}

describe('parseUtilityInvoice – Stromrechnung ab 2026', () => {
  it('nimmt die Messung als eigenen Block auf, statt sie fallen zu lassen', () => {
    const { bill, hinweise } = parseUtilityInvoice(stromrechnung2026())

    // Ohne den vierten Block fehlten der Sparte 42.15: 1'791.40 statt
    // 1'833.55 – und die Prüfung gegen das Zwischentotal schlug an.
    assert.deepEqual(hinweise, [])
    assert.deepEqual(bill?.sections[0]?.groups, [
      { group: 'energie', amountCents: 85_490 },
      { group: 'netznutzung', amountCents: 69_785 },
      { group: 'abgaben', amountCents: 23_865 },
      { group: 'messung', amountCents: 4215 },
    ])
    assert.equal(bill?.sections[0]?.amountCents, 183_355)
    assert.equal(bill?.subtotalCents, 183_355)
    assert.equal(bill?.prepaidCents, 87_000)
    assert.equal(bill?.totalCents, 96_355)
  })

  it('behält die Zeile der Messung samt ihrem Block', () => {
    const { bill } = parseUtilityInvoice(stromrechnung2026())
    const messung = bill?.sections[0]?.positions.find((p) => p.label === 'Messung')

    // Die Summenzeile ordnet die Position zu. Kennt der Parser den Block
    // nicht, verwirft er sie mitsamt dem Betrag.
    assert.equal(messung?.group, 'messung')
    assert.equal(messung?.rateHundredths, 650)
    assert.equal(messung?.durationMonths, 6)
    assert.equal(messung?.grossCents, 4215)
  })

  it('hält Tag- und Nachttarif auseinander, obwohl sie anders heissen als früher', () => {
    const { bill } = parseUtilityInvoice(stromrechnung2026())

    // Landen beide im selben Tarif, gelten sie als Zählerwechsel: Aus zwei
    // Zählern wird einer, dessen Stand von 31'185 auf 36'553 springt.
    assert.deepEqual(bill?.sections[0]?.readings, [
      {
        tariff: 'hoch',
        label: 'Wirkstrom Tagtarif',
        unit: 'kWh',
        startValue: 31_185,
        endValue: 33_945,
        quantity: 2760,
      },
      {
        tariff: 'nieder',
        label: 'Wirkstrom Nachttarif',
        unit: 'kWh',
        startValue: 34_093,
        endValue: 36_553,
        quantity: 2460,
      },
    ])
  })
})

// ------------------------------------------------- Wasser / Abwasser / Kehricht

const WASSER_KOPF = [
  'Rechnungsdatum: | 21.01.2026',
  'Abrechnung Nr. 242738 | Betrag CHF',
  'Wasser / Abwasser / Kehricht',
  'Periode vom 01.01.2025 - 31.12.2025',
  'Wasser | 424.75',
  'Abwasser | 399.00',
  'Kehricht | 100.00',
  'Zwischentotal | 923.75',
  'Akontoabzug | -460.00',
  'Rechnungsbetrag inkl. MWST | 463.75',
  'CHE-110.349.410 MWST CHF 5.65 (inkl. 2.60% von CHF 224.75)',
  'CHE-112.610.217 MWST CHF 14.15 (inkl. 8.10% von CHF 189.00)',
  'CHE-115.710.418 MWST CHF 3.75 (inkl. 8.10% von CHF 50.00)',
]

const WASSER_DETAIL = [
  'Wasser',
  'Messpunkt: CH8001911234500000000000000001565',
  'Verbrauchsermittlung | Messperiode | Zähler Nr. | Stand alt | Stand neu | Faktor | Menge',
  "Wasserverbrauch | 20.01.2025 | - | 06.01.2026 | 08663716 | 971 | 1'091 | 120 | m³",
  'Betragsermittlung | Menge | Ansatz | Dauer | exkl. MWST | Satz | inkl. MWST',
  'Wasserverbrauch | 120 | m³ | 1.25 | Fr. | 150.00 | 2.60 | 153.90',
  'Grundgebühr Wasser | 1 | 22.00 | Fr. | 12 Mt. | 264.00 | 2.60 | 270.85',
  'Total Wasser | 424.75',
  'Abwasser',
  'Betragsermittlung | Menge | Ansatz | Dauer | exkl. MWST | Satz | inkl. MWST',
  'Abwasserverbrauch | 120 | m³ | 1.55 | Fr. | 186.00 | 8.10 | 201.05',
  'Abwassergrundgebühr Wohnung | 1 | 90.00 | Fr. | 12 Mt. | 90.00 | 8.10 | 97.30',
  'Regenabwasser | 133 | m² | 70.00 | Rp. | 12 Mt. | 93.10 | 8.10 | 100.65',
  'Total Abwasser | 399.00',
  'Kehricht',
  'Betragsermittlung | Menge | Ansatz | Dauer | exkl. MWST | Satz | inkl. MWST',
  'Kehricht',
  'Kehrichtgebühr Wohnung | 1 | Anzahl | 100.00 | Fr. | 12 Mt. | 92.50 | 8.10 | 100.00',
  'Total Kehricht | 100.00',
]

function wasserrechnung(): PdfLine[] {
  return [...lines(WASSER_KOPF, 1), ...lines(WASSER_DETAIL, 2)]
}

describe('parseUtilityInvoice – Wasser, Abwasser und Kehricht', () => {
  it('macht aus einem Beleg drei Sparten', () => {
    const { bill, hinweise } = parseUtilityInvoice(wasserrechnung(), 'wasser.pdf')

    assert.deepEqual(hinweise, [])
    assert.deepEqual(
      bill?.sections.map((section) => [section.division, section.amountCents]),
      [
        ['wasser', 42_475],
        ['abwasser', 39_900],
        ['kehricht', 10_000],
      ],
    )
    // Akontoabzug und Rechnungsbetrag gelten für den ganzen Beleg.
    assert.equal(bill?.subtotalCents, 92_375)
    assert.equal(bill?.prepaidCents, 46_000)
    assert.equal(bill?.totalCents, 46_375)
  })

  it('zählt die Mehrwertsteuer über alle drei Sätze zusammen', () => {
    const { bill } = parseUtilityInvoice(wasserrechnung())

    assert.equal(bill?.vatCents, 565 + 1415 + 375)
  })

  it('verwechselt Abwasser nicht mit Wasser', () => {
    const { bill } = parseUtilityInvoice(wasserrechnung())
    const wasser = bill?.sections.find((section) => section.division === 'wasser')
    const abwasser = bill?.sections.find((section) => section.division === 'abwasser')

    assert.deepEqual(
      wasser?.positions.map((p) => p.label),
      ['Wasserverbrauch', 'Grundgebühr Wasser'],
    )
    assert.deepEqual(
      abwasser?.positions.map((p) => p.label),
      ['Abwasserverbrauch', 'Abwassergrundgebühr Wohnung', 'Regenabwasser'],
    )
  })

  it('liest die Ablesung des Wasserzählers als einzelnen Tarif', () => {
    const { bill } = parseUtilityInvoice(wasserrechnung())
    const wasser = bill?.sections.find((section) => section.division === 'wasser')

    assert.deepEqual(wasser?.readings, [
      {
        tariff: 'einzel',
        label: 'Wasserverbrauch',
        unit: 'm³',
        startValue: 971,
        endValue: 1091,
        quantity: 120,
      },
    ])
    assert.equal(wasser?.meterNumber, '08663716')
  })

  it('nimmt die Kehrichtgebühr mit, obwohl die Überschrift zweimal dasteht', () => {
    const { bill } = parseUtilityInvoice(wasserrechnung())
    const kehricht = bill?.sections.find((section) => section.division === 'kehricht')

    assert.equal(kehricht?.positions.length, 1)
    assert.equal(kehricht?.positions[0]?.label, 'Kehrichtgebühr Wohnung')
    assert.equal(kehricht?.positions[0]?.group, null)
  })

  it('meldet keine fehlende Ablesung beim Abwasser – dort gibt es nie eine', () => {
    const { hinweise } = parseUtilityInvoice(wasserrechnung())

    assert.equal(hinweise.length, 0)
  })
})

// ------------------------------------------------------------------- Akonto

describe('parseUtilityInvoice – Akontorechnung', () => {
  const akonto = lines([
    'Rechnungsdatum: | 09.07.2026',
    'Akontorechnung Nr. 247292 | Betrag CHF',
    'Wasser / Abwasser / Kehricht',
    'Periode vom 01.01.2026 - 30.06.2026',
    'Wasser | 220.00',
    'Abwasser | 200.00',
    'Kehricht | 50.00',
    'Rechnungsbetrag inkl. MWST | 470.00',
  ])

  it('erkennt sie als Vorauszahlung ohne Verbrauch', () => {
    const { bill, hinweise } = parseUtilityInvoice(akonto)

    assert.equal(bill?.kind, 'akonto')
    assert.equal(bill?.sections.length, 3)
    assert.ok(bill?.sections.every((section) => section.readings.length === 0))
    // Ohne Zwischentotal ergibt sich die Summe der Periode aus den Sparten.
    assert.equal(bill?.subtotalCents, 47_000)
    assert.equal(bill?.prepaidCents, 0)
    assert.equal(bill?.totalCents, 47_000)
    assert.deepEqual(hinweise, [])
  })
})

// ------------------------------------------------------------- Grenzfälle

describe('parseUtilityInvoice – was nicht hierher gehört', () => {
  it('meldet ein PDF ohne Rechnungsnummer, statt Zahlen zu erfinden', () => {
    const { bill, hinweise } = parseUtilityInvoice(lines(['Werbebrief', 'Sehr geehrte Kundin']))

    assert.equal(bill, null)
    assert.equal(hinweise.length, 1)
  })

  it('weist eine Rechnung ohne bekannte Sparte ab', () => {
    const fremd = lines([
      'Rechnungsdatum: | 01.02.2025',
      'Rechnung Nr. 4711 | Betrag CHF',
      'Kabelanschluss',
      'Periode vom 01.01.2025 - 31.12.2025',
      'Rechnungsbetrag inkl. MWST | 240.00',
    ])
    const { bill, hinweise } = parseUtilityInvoice(fremd)

    assert.equal(bill, null)
    assert.match(hinweise[0] as string, /keine der bekannten Sparten/)
  })

  it('meldet, wenn die Sparten nicht das Zwischentotal ergeben', () => {
    const kaputt = WASSER_KOPF.map((row) =>
      row.startsWith('Abwasser |') ? 'Abwasser | 299.00' : row,
    )
    const { bill, hinweise } = parseUtilityInvoice([...lines(kaputt, 1), ...lines(WASSER_DETAIL, 2)])

    // Gelesen wird trotzdem – korrigieren lässt sich das im Formular.
    assert.ok(bill)
    assert.equal(hinweise.length, 1)
    assert.match(hinweise[0] as string, /Zwischentotal/)
  })

  it('meldet einen Zählerstand, der nicht zur verrechneten Menge passt', () => {
    const kaputt = STROM_DETAIL.map((row) =>
      row.startsWith('Wirkstrom Niedertarif | 28.06')
        ? "Wirkstrom Niedertarif | 28.06.2024 | - | 20.01.2025 | 27'441 | 29'606 | 2'999 | kWh"
        : row,
    )
    const { hinweise } = parseUtilityInvoice([...lines(STROM_KOPF, 1), ...lines(kaputt, 2)])

    assert.ok(hinweise.some((hinweis) => /Niedertarif/.test(hinweis)))
  })
})
