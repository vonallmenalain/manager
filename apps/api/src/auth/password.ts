import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id mit bewusst moderaten Parametern: Das NAS ist kein Rechenzentrum,
 * und bei zwei Nutzern zählt eine flüssige Anmeldung mehr als die letzte
 * Millisekunde Angriffsresistenz. ~64 MB und 3 Durchgänge liegen weiterhin
 * deutlich über den OWASP-Mindestwerten.
 */
const options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, options)
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, options)
  } catch {
    // Ein beschädigter oder fremdformatiger Hash ist kein Serverfehler,
    // sondern schlicht ein fehlgeschlagener Login.
    return false
  }
}
