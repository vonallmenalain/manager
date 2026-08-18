import type { ManagedDocument } from '@manager/shared'
import { Link } from 'react-router-dom'

import { DocumentIcon } from './icons'
import { useThumbnailUrl } from '../lib/documents'
import { useInView } from '../lib/inView'

/**
 * Ein Dokument als Kachel.
 *
 * Die Liste beantwortet „wie heisst es und wann war es", die Kachel „wie sieht
 * es aus". Das ist in einer Sammlung, die man durchblättert, oft die
 * schnellere Frage: Ein Kursskript, ein EKG-Ausdruck und ein Merkblatt
 * unterscheidet man auf einen Blick, lange bevor man drei Titel gelesen hat.
 *
 * Das Bild kommt erst, wenn die Kachel in die Nähe des Bildschirms gerät –
 * siehe useInView. Sonst lüde eine Sammlung mit fünfzig Einträgen fünfzig
 * Bilder, von denen man vier sieht.
 */
export function DocumentTile({
  document,
  categoryName,
}: {
  document: ManagedDocument
  categoryName?: string
}) {
  const [ref, sichtbar] = useInView<HTMLLIElement>()
  const { url, isError } = useThumbnailUrl(document.id, sichtbar)

  return (
    <li ref={ref}>
      <Link
        to={`/${document.id}`}
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
      >
        {/* Feste Seitenverhältnisse: Ein Raster, in dem jede Kachel so hoch ist
            wie ihr Bild, springt beim Laden herum. 3:4 ist das Verhältnis eines
            Blattes im Hochformat – dem Normalfall in einer Dokumentensammlung. */}
        <span className="relative block aspect-3/4 w-full bg-slate-100 dark:bg-slate-950">
          {url ? (
            <img
              src={url}
              alt=""
              loading="lazy"
              // 'top': Bei einem hohen Dokument zeigt die Kachel den Kopf –
              // dort stehen Titel und Absender. Zentriert wäre die Mitte des
              // Fliesstexts zu sehen, und die sagt nichts.
              className="absolute inset-0 size-full object-cover object-top"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-slate-400">
              {isError ? (
                <DocumentIcon className="size-8" />
              ) : (
                <span className="size-5 animate-pulse rounded-full bg-slate-300 dark:bg-slate-700" />
              )}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1 p-2">
          {/* break-words: Bei vier Kacheln nebeneinander ist eine Kachel auf
              dem Handy keine achtzig Bildpunkte breit, und „Antibiotikatherapie"
              passt in keine Zeile. Ohne den Umbruch im Wort steht die zweite
              Hälfte ausserhalb der Kachel und ist einfach weg.

              Kein `block` daneben: `line-clamp` bringt seine eigene Anzeigeart
              mit, und `block` gewinnt – dann würde gar nicht mehr abgeschnitten
              und eine Kachel mit langem Titel zöge ihre ganze Reihe in die
              Höhe. */}
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug">
            {document.title}
          </span>
          <span className="mt-0.5 line-clamp-2 break-words text-xs text-slate-500 dark:text-slate-400">
            {document.docDate}
            {categoryName ? ` · ${categoryName}` : ''}
          </span>
        </span>
      </Link>
    </li>
  )
}
