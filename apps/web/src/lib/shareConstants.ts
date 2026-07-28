/**
 * Gemeinsame Werte für das Teilen aus anderen Apps.
 *
 * Service Worker und Oberfläche sind zwei getrennte Bundles, die sich über
 * diesen Zwischenspeicher verständigen. Stünde der Name an zwei Stellen und
 * liefe je auseinander, würde das Teilen ohne jede Fehlermeldung aufhören zu
 * funktionieren: Der Worker legt ab, die Oberfläche sucht woanders.
 */
export const SHARE_CACHE = 'geteilte-dateien'

/** Kopfzeile, in der der ursprüngliche Dateiname mitreist. */
export const SHARE_FILENAME_HEADER = 'x-dateiname'

/** Adresse, an die Android den POST schickt (muss zum Manifest passen). */
export const SHARE_TARGET_PATH = '/share-target'
