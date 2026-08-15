/**
 * Reine Pfad-Logik der Dokumentenablage.
 *
 * Bewusst ohne jede Abhängigkeit ausser `node:path`: Hier steckt die
 * Sicherheitsprüfung gegen Pfad-Ausbrüche, und die soll ohne Konfiguration,
 * ohne Datenbank und ohne Dateisystem prüfbar sein.
 */
import { join, resolve, sep } from 'node:path'

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
}

const UMLAUTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
}

/**
 * Macht aus beliebigem Text einen Dateinamen-Baustein, der auf jedem
 * Dateisystem und in jeder Freigabe funktioniert – auch über SMB von einem
 * Windows-Rechner aus, wo etwa ':' und '?' verboten sind.
 *
 * Deutsche Umlaute werden ausgeschrieben statt entfernt: 'Vertraege' bleibt
 * lesbar, 'Vertrge' nicht.
 */
export function slugify(input: string): string {
  const replaced = input.replace(/[äöüÄÖÜß]/g, (char) => UMLAUTS[char] ?? char)
  const slug = replaced
    .normalize('NFD')
    // Kombinierende diakritische Zeichen entfernen (é → e), nachdem die
    // deutschen Umlaute oben bereits sinnwahrend ersetzt wurden.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  return slug || 'Dokument'
}

export function extensionFor(mimeType: string, originalName: string): string {
  const known = EXTENSION_BY_MIME[mimeType]
  if (known) return known

  const fromName = originalName.split('.').pop()
  if (fromName && /^[a-zA-Z0-9]{1,8}$/.test(fromName)) return fromName.toLowerCase()
  return 'bin'
}

export interface StoragePathParts {
  docDate: string
  categoryName: string | null
  /**
   * Die Hauptkategorie, falls `categoryName` eine Unterkategorie ist. Sie wird
   * zu einem eigenen Ordner davor – die Ordnerstruktur bildet damit dieselbe
   * Schachtelung ab wie die App.
   */
  parentCategoryName?: string | null
  title: string
  documentId: string
  extension: string
}

/**
 * Erzeugt den Ablagepfad. Ziel ist, dass die Ordnerstruktur auch ohne die App
 * verständlich bleibt: Jahr, Kategorie, Datum und Titel stehen im Klartext.
 * Die kurze ID am Ende hält den Namen eindeutig, wenn zwei Dokumente gleich
 * heissen – etwa zwölf Monatsrechnungen desselben Anbieters.
 *
 * Bei einer Unterkategorie kommt ein Ordner dazu: `2026/Notfall/Medikamente/…`.
 * Ohne ihn lägen „Notfall › Medikamente" und „Alltag › Medikamente" auf dem
 * NAS im selben Ordner – zwei Schubladen der App, ein Haufen in der Freigabe.
 */
export function buildStoragePath(parts: StoragePathParts): string {
  const year = parts.docDate.slice(0, 4)
  const category = slugify(parts.categoryName ?? 'Unsortiert')
  // Ohne Kategorie gibt es auch keine Hauptkategorie darüber – „Unsortiert"
  // bleibt eine einzige Ebene.
  const parent = parts.categoryName && parts.parentCategoryName
    ? [slugify(parts.parentCategoryName)]
    : []
  const shortId = parts.documentId.replace(/-/g, '').slice(0, 8)
  const name = `${parts.docDate}__${slugify(parts.title)}__${shortId}.${parts.extension}`
  return join(year, ...parent, category, name)
}

/**
 * Der Pfad der .txt-Datei, die neben dem Original den erkannten Text trägt.
 *
 * Sie hängt am Dateinamen und nicht an der Kennung: In der Freigabe soll neben
 * `2026-03-14__Rechnung__a3f9c1d2.pdf` die `…__a3f9c1d2.txt` liegen und nicht
 * irgendwo eine Datei, die man dem Dokument nicht ansieht. Der Preis ist, dass
 * sie bei einem Wechsel der Endung ihren Namen verliert – wer die Datei
 * ersetzt, räumt die alte deshalb weg.
 */
export function textSidecarPath(storagePath: string): string {
  return storagePath.replace(/\.[^./\\]+$/, '.txt')
}

/**
 * Löst einen relativen Pfad unterhalb von `root` auf und stellt sicher, dass
 * er dieses Verzeichnis nicht verlässt. Ohne diese Prüfung könnte ein in der
 * Datenbank manipulierter Pfad auf beliebige Dateien des NAS zeigen.
 */
export function resolveWithin(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error(`Pfad liegt ausserhalb der Ablage: ${relativePath}`)
  }
  return absolute
}
