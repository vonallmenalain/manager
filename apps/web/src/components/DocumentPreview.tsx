import { useEffect, useState } from 'react'

import {
  fileUrl,
  useFileBlobUrl,
  usePrefetchPreviewPage,
  usePreviewInfo,
  usePreviewPageUrl,
} from '../lib/documents'

/**
 * Die Vorschau eines Dokuments.
 *
 * Zwei getrennte Wege, weil ein Browser mit den beiden Dateiarten sehr
 * unterschiedlich umgeht:
 *
 *   Bilder  – kann er selbst darstellen. Sie werden über fetch() geholt und
 *             als blob:-Adresse angezeigt, nicht direkt von der API-Adresse:
 *             Letztere verbietet die Sicherheitsrichtlinie der Seite (img-src
 *             erlaubt nur die eigene Herkunft), weshalb bisher nur das kaputte
 *             Bildsymbol zu sehen war.
 *   PDFs    – kann er auf dem Handy gerade nicht darstellen. Chrome auf
 *             Android hat keinen eingebauten Betrachter, in einer
 *             installierten PWA erst recht nicht. Deshalb rastert der Server
 *             die Seiten zu Bildern, und die Vorschau blättert durch sie.
 */
export function DocumentPreview({
  id,
  mimeType,
  title,
}: {
  id: string
  mimeType: string
  title: string
}) {
  const info = usePreviewInfo(id)

  if (info.isPending) return <PreviewFrame><Spinner /></PreviewFrame>

  // Fällt die Abfrage aus, bleibt die alte Unterscheidung anhand des Dateityps:
  // ein Bild versuchen wir trotzdem, alles andere nicht.
  const kind = info.data?.kind ?? (mimeType.startsWith('image/') ? 'image' : 'none')

  if (kind === 'image') return <ImagePreview id={id} title={title} />
  if (kind === 'pdf') return <PdfPreview id={id} pages={info.data?.pages ?? 1} title={title} />
  return <NoPreview id={id} />
}

function ImagePreview({ id, title }: { id: string; title: string }) {
  const { url, isLoading, isError } = useFileBlobUrl(id, true)
  // HEIC von einem iPhone oder ein TIFF vom Scanner: Der Server liefert die
  // Datei anstandslos, nur kann sie nicht jeder Browser zeichnen. Das merkt
  // man erst, wenn das <img> aufgibt.
  const [undecodable, setUndecodable] = useState(false)

  useEffect(() => {
    setUndecodable(false)
  }, [url])

  if (isError || undecodable) return <NoPreview id={id} />
  if (isLoading || !url) return <PreviewFrame><Spinner /></PreviewFrame>

  // Der Tap führt bewusst auf die API-Adresse und nicht auf die blob:-Adresse:
  // Eine gewöhnliche Navigation darf dorthin, und das Bild landet damit im
  // Betrachter des Systems statt in einem Tab, der nach dem Neuladen leer ist.
  return (
    <a href={fileUrl(id)} target="_blank" rel="noreferrer" className="block">
      <img
        src={url}
        alt={title}
        onError={() => setUndecodable(true)}
        className="max-h-96 w-full rounded-2xl border border-slate-200 bg-slate-50 object-contain dark:border-slate-800 dark:bg-slate-900"
      />
    </a>
  )
}

function PdfPreview({ id, pages, title }: { id: string; pages: number; title: string }) {
  const [page, setPage] = useState(1)
  const { url, isLoading, isError } = usePreviewPageUrl(id, page, true)

  // Die nächste Seite still im Hintergrund holen, damit das Blättern nicht
  // jedes Mal an einem Ladebalken hängt.
  usePrefetchPreviewPage(id, page + 1, page < pages)

  if (isError) return <NoPreview id={id} />

  return (
    <div className="space-y-2">
      {isLoading || !url ? (
        <PreviewFrame>
          <Spinner />
        </PreviewFrame>
      ) : (
        <a href={fileUrl(id)} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={`${title} – Seite ${page} von ${pages}`}
            className="max-h-96 w-full rounded-2xl border border-slate-200 bg-slate-50 object-contain dark:border-slate-800 dark:bg-slate-900"
          />
        </a>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <PageButton
            label="Vorherige Seite"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <path d="m14 6-6 6 6 6" />
          </PageButton>
          <span className="min-w-28 text-center text-sm tabular-nums text-slate-500 dark:text-slate-400">
            Seite {page} von {pages}
          </span>
          <PageButton
            label="Nächste Seite"
            disabled={page >= pages}
            onClick={() => setPage((current) => Math.min(pages, current + 1))}
          >
            <path d="m10 6 6 6-6 6" />
          </PageButton>
        </div>
      ) : null}
    </div>
  )
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // min-h-11: Auf dem Handy muss der Knopf mit dem Daumen zu treffen sein.
      className="grid size-11 min-h-11 place-items-center rounded-xl border border-slate-300 bg-white transition active:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  )
}

/** Der Platzhalter, wenn sich nichts anzeigen lässt – mit dem Weg zur Datei. */
function NoPreview({ id }: { id: string }) {
  return (
    <PreviewFrame>
      <p className="px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Vorschau hier nicht möglich –{' '}
        <a
          href={fileUrl(id)}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-700 underline dark:text-brand-300"
        >
          Datei öffnen
        </a>
      </p>
    </PreviewFrame>
  )
}

/** Fester Rahmen für Lade- und Fehlerzustand, damit nichts springt. */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-64 place-items-center rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="size-6 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600 dark:border-t-transparent"
      role="status"
      aria-label="Vorschau wird geladen"
    />
  )
}
