import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),

  /** Verzeichnis der SQLite-Datei. Muss auf einem lokalen Volume liegen, nicht auf NFS/SMB. */
  DB_DIR: z.string().default('./data'),
  /** Wurzel der Dokumentenablage. Darf auf einer beliebigen QNAP-Freigabe liegen. */
  STORAGE_DIR: z.string().default('./storage'),

  /** Erlaubter Origin des Frontends – strikt, kein Wildcard. */
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Cookie-Domain, z.B. '.alae.app'. Leer lassen für localhost. */
  COOKIE_DOMAIN: z.string().optional(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET muss mindestens 32 Zeichen haben'),
  /** Sitzungsdauer in Tagen. Lang, damit man sich am Handy nicht ständig neu anmeldet. */
  SESSION_DAYS: z.coerce.number().int().positive().default(90),

  /**
   * Einmal-Token für die Ersteinrichtung. Wirkt nur, solange kein Nutzer existiert –
   * danach ist der Endpunkt tot, auch wenn die Variable gesetzt bleibt.
   */
  SETUP_TOKEN: z.string().min(8).optional(),

  /** Hinter cloudflared steht ein Proxy davor – sonst sieht jeder Request wie 127.0.0.1 aus. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Sprachen für die Texterkennung, durch '+' getrennt. Nicht installierte
   * Sprachen werden beim Start automatisch aussortiert – Tesseract würde
   * sonst bei jeder einzelnen Erkennung abbrechen statt sie zu überspringen.
   */
  OCR_LANGUAGES: z.string().default('deu+fra+eng'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Env = z.infer<typeof envSchema>

function load(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    // Beim Start hart abbrechen: eine halb konfigurierte API ist schlimmer als keine.
    console.error(`Ungültige Konfiguration:\n${details}`)
    process.exit(1)
  }
  return parsed.data
}

export const env = load()

export const isProduction = env.NODE_ENV === 'production'
