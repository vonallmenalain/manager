#!/usr/bin/env node
/**
 * Sicherheits-Gate für die CI.
 *
 * `npm audit` alleine taugt nicht als Gate: Sobald ein Hinweis auftaucht, der
 * auf diese App nicht zutrifft, schaltet man den Befehl irgendwann ganz ab –
 * und merkt dann auch die echten Probleme nicht mehr. Stattdessen prüfen wir
 * gegen eine ausdrückliche, begründete Ausnahmeliste. Alles was dort nicht
 * steht, lässt den Build scheitern.
 *
 * Geprüft werden nur Laufzeit-Abhängigkeiten (--omit=dev): Build-Werkzeuge
 * laufen nie auf dem NAS und nie im Browser eines Nutzers.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BLOCKING = new Set(['high', 'critical'])

function loadExceptions() {
  const raw = readFileSync(join(ROOT, 'security-exceptions.json'), 'utf8')
  const { exceptions } = JSON.parse(raw)
  const today = new Date().toISOString().slice(0, 10)

  const stale = exceptions.filter((entry) => entry.reviewAfter < today)
  if (stale.length > 0) {
    console.error('Ausnahmen sind zur Überprüfung fällig:\n')
    for (const entry of stale) {
      console.error(`  ${entry.id} (${entry.package}) – fällig seit ${entry.reviewAfter}`)
    }
    console.error('\nBitte prüfen, ob der Hinweis inzwischen behoben ist, und das Datum')
    console.error('in security-exceptions.json neu setzen oder den Eintrag entfernen.')
    process.exit(1)
  }

  return new Set(exceptions.map((entry) => entry.id))
}

function runAudit() {
  try {
    const output = execFileSync('npm', ['audit', '--json', '--omit=dev'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch (error) {
    // npm audit beendet sich mit Code 1, sobald es etwas findet – das ist der
    // Normalfall und kein Ausführungsfehler. Der Bericht steht trotzdem in stdout.
    if (error.stdout) return JSON.parse(error.stdout)
    throw error
  }
}

const allowed = loadExceptions()
const report = runAudit()

const blocking = []
for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object') continue
    const id = via.url?.split('/').pop() ?? ''
    if (allowed.has(id)) continue
    if (!BLOCKING.has(via.severity)) continue
    blocking.push({ pkg, id, title: via.title, severity: via.severity })
  }
}

if (blocking.length === 0) {
  const count = allowed.size
  console.log(
    `Sicherheitsprüfung bestanden – keine offenen Hinweise ab 'high'` +
      (count > 0 ? ` (${count} begründete Ausnahme${count === 1 ? '' : 'n'}).` : '.'),
  )
  process.exit(0)
}

console.error(`${blocking.length} nicht abgedeckte Sicherheitshinweise:\n`)
for (const item of blocking) {
  console.error(`  [${item.severity}] ${item.pkg}: ${item.title}`)
  console.error(`      https://github.com/advisories/${item.id}\n`)
}
console.error('Entweder die Abhängigkeit aktualisieren oder – mit Begründung –')
console.error('in security-exceptions.json aufnehmen.')
process.exit(1)
