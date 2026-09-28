/**
 * Gemeinsame Werte für das Teilen aus anderen Apps.
 *
 * Service Worker und Oberfläche sind zwei getrennte Bundles, die sich über
 * diesen Zwischenspeicher verständigen. Stünde der Name an zwei Stellen und
 * liefe je auseinander, würde das Teilen ohne jede Fehlermeldung aufhören zu
 * funktionieren: Der Worker legt ab, die Oberfläche sucht woanders.
 */
// Mit .ts-Endung, damit `node --test` die Datei ohne Bündler laden kann.
import { DOCBASE_SCOPE, MANAGER_SCOPE } from './appScopes.ts'

/**
 * Der Zwischenspeicher des Managers.
 *
 * Jede App hat ihren eigenen: Die Cache Storage gehört der ganzen Adresse,
 * nicht einer App. Mit einem gemeinsamen Namen fände der Manager, was eben an
 * die DocBase geteilt wurde – und räumte es beim nächsten Teilen weg.
 */
export const SHARE_CACHE = 'geteilte-dateien'

/** Der Zwischenspeicher der DocBase. */
export const DOCBASE_SHARE_CACHE = 'docbase-geteilt'

/** Kopfzeile, in der der ursprüngliche Dateiname mitreist. */
export const SHARE_FILENAME_HEADER = 'x-dateiname'

/**
 * Präfix der Schlüssel, unter denen die geteilten Dateien liegen.
 *
 * Im selben Zwischenspeicher liegt seit dem Teilen von Verweisen auch ein
 * Eintrag mit Titel, Text und Adresse. Beides unterscheidet sich allein am
 * Schlüssel: Wer die Dateien abholt, muss den Texteintrag überspringen, sonst
 * landet dessen JSON als „Datei" in der Ablage.
 */
export const SHARE_FILE_PREFIX = '/__geteilt/datei-'

/** Schlüssel des Texteintrags: Titel, Text und Adresse eines Teilens. */
export const SHARE_TEXT_KEY = '/__geteilt/text'

/**
 * Schlüssel des Protokolls: Was Android beim Teilen tatsächlich übergeben hat.
 *
 * Kommt nichts Brauchbares an, weiss sonst niemand, warum – ob die andere App
 * gar keine Datei mitgab, eine leere oder eine, die der Browser nicht lesen
 * konnte. Das Protokoll hält nur Namen, Arten und Grössen fest, keine Inhalte,
 * und die Auswahlseite zeigt es an, wenn nichts angekommen ist.
 */
export const SHARE_LOG_KEY = '/__geteilt/protokoll'

export interface ShareProtokollFeld {
  /** Der Name des Formularfelds – `files`, `title`, `text` oder `url`. */
  name: string
  art: 'text' | 'datei'
  /** Zeichen bei Text, Bytes bei einer Datei. */
  laenge: number
  /** Dateiname und Typ, wie sie ankamen. */
  datei?: string
  typ?: string
}

export interface ShareProtokoll {
  felder: ShareProtokollFeld[]
}

/**
 * Der Name des Teilen-Ziels, wie ihn der Router kennt.
 *
 * Als Seite gebraucht nur für den Fall, dass kein Service Worker den POST
 * abgefangen hat: Dann kommt der Aufruf als gewöhnlicher Seitenaufruf an, und
 * statt kommentarlos auf der Startseite zu landen, steht dort, was passiert
 * ist (siehe `screens/ShareMissed.tsx`).
 */
export const SHARE_TARGET_ROUTE = 'share-target'

/**
 * Adresse, an die Android den POST schickt (muss zum Manifest passen).
 *
 * Mit dem Geltungsbereich davor: Ein Teilen-Ziel ausserhalb des eigenen
 * Bereichs lehnt der Browser ab.
 */
export const SHARE_TARGET_PATH = `${MANAGER_SCOPE}${SHARE_TARGET_ROUTE}`

/**
 * Die Seite, auf der nach dem Teilen das Ziel gewählt wird.
 *
 * Früher leitete der Worker geradewegs in die Dokumente. Das ging gut, solange
 * nur PDFs und Fotos ankamen – ein geteilter Verweis aber ist keine Datei und
 * verschwand dort wortlos. Seither entscheidet diese Seite, was mit dem
 * Geteilten geschieht: ablegen oder aufschreiben.
 *
 * Zwei Fassungen, weil sie an zwei Stellen gebraucht wird: der Router kennt
 * nur den Teil hinter `/app`, der Service Worker braucht die ganze Adresse.
 */
export const SHARE_LANDING_ROUTE = 'teilen'
export const SHARE_LANDING_PATH = `${MANAGER_SCOPE}${SHARE_LANDING_ROUTE}`

/** Teilen-Ziel und Auswahlseite der DocBase – dieselbe Einrichtung, eigener Bereich. */
export const DOCBASE_SHARE_TARGET_PATH = `${DOCBASE_SCOPE}${SHARE_TARGET_ROUTE}`
export const DOCBASE_SHARE_LANDING_PATH = `${DOCBASE_SCOPE}${SHARE_LANDING_ROUTE}`

/**
 * Das Teilen-Ziel der Installationen von vor dem Umzug nach `/app/`.
 *
 * Android hat Name, Symbol und Teilen-Ziel einer installierten App fest in
 * ihrem Paket stehen. Eine App, die noch auf `/` installiert wurde, schickt
 * deshalb weiterhin an `/share-target` – und dort war seit dem Umzug niemand
 * mehr: Netlify leitete nach `/app/share-target` um, aus dem POST wurde ein
 * gewöhnlicher Aufruf, die Dateien waren weg, und die App zeigte ihre
 * Startseite. Seither fängt der Worker an der Wurzel diesen Aufruf ab (siehe
 * `legacy-root/sw.js`).
 */
export const LEGACY_SHARE_TARGET_PATH = '/share-target'
