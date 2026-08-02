/**
 * Gemeinsame Werte für das Teilen aus anderen Apps.
 *
 * Service Worker und Oberfläche sind zwei getrennte Bundles, die sich über
 * diesen Zwischenspeicher verständigen. Stünde der Name an zwei Stellen und
 * liefe je auseinander, würde das Teilen ohne jede Fehlermeldung aufhören zu
 * funktionieren: Der Worker legt ab, die Oberfläche sucht woanders.
 */
// Mit .ts-Endung, damit `node --test` die Datei ohne Bündler laden kann.
import { MANAGER_SCOPE } from './appScopes.ts'

export const SHARE_CACHE = 'geteilte-dateien'

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
 * Adresse, an die Android den POST schickt (muss zum Manifest passen).
 *
 * Mit dem Geltungsbereich davor: Ein Teilen-Ziel ausserhalb des eigenen
 * Bereichs lehnt der Browser ab.
 */
export const SHARE_TARGET_PATH = `${MANAGER_SCOPE}share-target`

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
