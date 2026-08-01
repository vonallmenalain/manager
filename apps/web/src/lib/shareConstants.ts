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
 * Adresse, an die Android den POST schickt (muss zum Manifest passen).
 *
 * Mit dem Geltungsbereich davor: Ein Teilen-Ziel ausserhalb des eigenen
 * Bereichs lehnt der Browser ab.
 */
export const SHARE_TARGET_PATH = `${MANAGER_SCOPE}share-target`
