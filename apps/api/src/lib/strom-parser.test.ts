import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PdfLine } from './pdf-text.ts'
import { parseElectricityInvoice } from './strom-parser.ts'

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

const KOPF = [
  'Kundennummer: | 18444 / 4086',
  'Rechnungsdatum: | 23.01.2025',
  'EFH (Einfamilienhaus), Kirchmattweg 12, 3414 Oberburg',
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

const DETAIL = [
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
  "Netz Niedertarif | 2'165 | kWh | 10.10 | Rp. | 218.65 | 8.10 | 236.35",
  'Grundpreis | 1 | 12.50 | Fr. | 6 Mt. | 75.00 | 8.10 | 81.10',
  'Total Netznutzung | 750.80',
  'Netznutzung NS Haushalt',
  "Abgaben Gemeinwesen | 5'451 | kWh | 1.20 | Rp. | 65.40 | 8.10 | 70.70",
  "Stromreserve | 5'451 | kWh | 1.20 | Rp. | 65.40 | 8.10 | 70.70",
  'Total Gesetzliche Abgaben und Förderbeiträge | 321.10',
]

function abrechnung(): PdfLine[] {
  return [...lines(KOPF, 1), ...lines(DETAIL, 2)]
}

describe('parseElectricityInvoice – Abrechnung', () => {
  it('liest Kopfdaten, Beträge und Verbrauch ohne Hinweise', () => {
    const { bill, hinweise } = parseElectricityInvoice(abrechnung(), 'rechnung.pdf')

    assert.deepEqual(hinweise, [])
    assert.ok(bill)
    assert.equal(bill.kind, 'abrechnung')
    assert.equal(bill.invoiceNumber, '231125')
    assert.equal(bill.invoiceDate, '2025-01-23')
    assert.equal(bill.periodStart, '2024-07-01')
    assert.equal(bill.periodEnd, '2024-12-31')
    assert.equal(bill.customerNumber, '18444 / 4086')
    assert.equal(bill.meterPoint, 'CH1071601234500000000000000000919')
    assert.equal(bill.meterNumber, '3760')
    assert.equal(bill.sourceFile, 'rechnung.pdf')
  })

  it('rechnet die Beträge in Rappen um', () => {
    const { bill } = parseElectricityInvoice(abrechnung())

    assert.equal(bill?.energyCents, 109_015)
    assert.equal(bill?.gridCents, 75_080)
    assert.equal(bill?.leviesCents, 32_110)
    assert.equal(bill?.subtotalCents, 216_205)
    assert.equal(bill?.prepaidCents, 62_000)
    assert.equal(bill?.totalCents, 154_205)
    assert.equal(bill?.vatCents, 11_550)
  })

  it('summiert den Verbrauch über einen Zählerwechsel hinweg', () => {
    const { bill } = parseElectricityInvoice(abrechnung())

    // Der Hochtarif steht in zwei Zeilen: 0 kWh bis zum Wechsel, 3'286 danach.
    // Der Anfangsstand kommt aus der ersten Zeile, der Endstand aus der letzten.
    assert.deepEqual(bill?.readings, [
      { tariff: 'hoch', startValue: 22_796, endValue: 26_082, kwh: 3286 },
      { tariff: 'nieder', startValue: 27_441, endValue: 29_606, kwh: 2165 },
    ])
  })

  it('ordnet die Positionen ihrer Kostengruppe zu', () => {
    const { bill } = parseElectricityInvoice(abrechnung())
    const gruppen = bill?.positions.map((position) => `${position.group}:${position.label}`)

    assert.deepEqual(gruppen, [
      'energie:Wirkstrom Hochtarif',
      'energie:Wirkstrom Niedertarif',
      'netznutzung:Netz Hochtarif',
      'netznutzung:Netz Niedertarif',
      'netznutzung:Grundpreis',
      // Der Abgabenblock trägt dieselbe Überschrift wie die Netznutzung –
      // zugeordnet wird deshalb über die Summenzeile darunter.
      'abgaben:Abgaben Gemeinwesen',
      'abgaben:Stromreserve',
    ])
  })

  it('liest Menge, Ansatz und Steuersatz einer Position', () => {
    const { bill } = parseElectricityInvoice(abrechnung())
    const hochtarif = bill?.positions[0]

    assert.deepEqual(hochtarif, {
      group: 'energie',
      label: 'Wirkstrom Hochtarif',
      quantity: 3286,
      unit: 'kWh',
      rateHundredths: 1850,
      rateUnit: 'Rp.',
      durationMonths: null,
      vatBasisPoints: 810,
      netCents: 60_790,
      grossCents: 65_715,
    })
  })

  it('kommt mit dem Grundpreis zurecht, der eine Spalte weniger belegt', () => {
    const { bill } = parseElectricityInvoice(abrechnung())
    const grundpreis = bill?.positions.find((position) => position.label === 'Grundpreis')

    assert.equal(grundpreis?.quantity, 1)
    assert.equal(grundpreis?.rateHundredths, 1250)
    assert.equal(grundpreis?.rateUnit, 'Fr.')
    assert.equal(grundpreis?.durationMonths, 6)
    assert.equal(grundpreis?.grossCents, 8110)
  })
})

describe('parseElectricityInvoice – Akontorechnung', () => {
  const akonto = lines([
    'Rechnungsdatum: | 11.04.2025',
    'Messpunkt: | CH1071601234500000000000000000919',
    'Akontorechnung Nr. 232709 | Betrag CHF',
    'Elektrizität',
    'Periode vom 01.01.2025 - 31.03.2025',
    'Energie | 540.00',
    'Netznutzung | 370.00',
    'Gesetzliche Abgaben und Förderbeiträge | 160.00',
    'Rechnungsbetrag inkl. MWST | 1’070.00',
    'CHE-110.349.410 MWST CHF 80.25 (inkl. 8.10% von CHF 1’070.00)',
  ])

  it('erkennt sie als Vorauszahlung ohne Verbrauch', () => {
    const { bill, hinweise } = parseElectricityInvoice(akonto)

    assert.equal(bill?.kind, 'akonto')
    assert.equal(bill?.invoiceNumber, '232709')
    assert.deepEqual(bill?.readings, [])
    assert.deepEqual(bill?.positions, [])
    // Ohne Zwischentotal ergibt sich die Summe der Periode aus den drei Blöcken.
    assert.equal(bill?.subtotalCents, 107_000)
    assert.equal(bill?.prepaidCents, 0)
    assert.equal(bill?.totalCents, 107_000)
    assert.deepEqual(hinweise, [])
  })
})

describe('parseElectricityInvoice – was nicht hierher gehört', () => {
  it('weist eine Wasserrechnung mit klarer Begründung ab', () => {
    const wasser = lines([
      'Rechnungsdatum: | 09.07.2025',
      'Akontorechnung Nr. 235057 | Betrag CHF',
      'Wasser / Abwasser / Kehricht',
      'Periode vom 01.01.2025 - 30.06.2025',
      'Wasser | 200.00',
      'Abwasser | 210.00',
      'Kehricht | 50.00',
      'Rechnungsbetrag inkl. MWST | 460.00',
    ])

    const { bill, hinweise } = parseElectricityInvoice(wasser)

    assert.equal(bill, null)
    assert.match(hinweise[0] ?? '', /Wasser \/ Abwasser \/ Kehricht/)
  })

  it('meldet ein PDF ohne Rechnungsnummer, statt Zahlen zu erfinden', () => {
    const { bill, hinweise } = parseElectricityInvoice(lines(['Werbebrief', 'Sehr geehrte Kundin']))

    assert.equal(bill, null)
    assert.equal(hinweise.length, 1)
  })
})

describe('parseElectricityInvoice – Unstimmigkeiten', () => {
  it('meldet, wenn die Blöcke nicht das Zwischentotal ergeben', () => {
    const kaputt = KOPF.map((row) =>
      row.startsWith('Netznutzung |') ? 'Netznutzung | 700.80' : row,
    )
    const { bill, hinweise } = parseElectricityInvoice([...lines(kaputt, 1), ...lines(DETAIL, 2)])

    // Gelesen wird trotzdem – korrigieren lässt sich das im Formular.
    assert.ok(bill)
    assert.deepEqual(hinweise.length, 1)
    assert.match(hinweise[0] as string, /Zwischentotal/)
  })

  it('meldet einen Zählerstand, der nicht zur verrechneten Menge passt', () => {
    const kaputt = DETAIL.map((row) =>
      row.startsWith('Wirkstrom Niedertarif | 28.06')
        ? "Wirkstrom Niedertarif | 28.06.2024 | - | 20.01.2025 | 27'441 | 29'606 | 2'999 | kWh"
        : row,
    )
    const { hinweise } = parseElectricityInvoice([...lines(KOPF, 1), ...lines(kaputt, 2)])

    assert.ok(hinweise.some((hinweis) => /Niedertarif/.test(hinweis)))
  })
})
