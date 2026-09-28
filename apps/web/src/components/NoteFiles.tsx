import { formatFileSize, type RichFile } from '@manager/shared'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  noteFileUrl,
  useNoteFileImage,
  useNoteFilePage,
  useNoteFilePreview,
  useNoteThumbnail,
  type EinfuegeArt,
  type Fortschritt,
} from '../lib/noteFiles'
import {
  FILE_BLOCK,
  FILE_CHIP_BUTTON,
  FILE_CHIP_ICON,
  FILE_CHIP_TEXT,
  FILE_CHIP_THUMB,
  FILE_COMPACT,
  FILE_IMAGE,
  FILE_IMAGE_BUTTON,
  FILE_META,
  FILE_NAME,
  fileMeta,
  isImage,
} from '../lib/noteFileStyles'
import { useFullScreenOverlay } from '../lib/overlay'

/**
 * Dateien in Notizen – wie sie im gelesenen Text stehen, wie sie sich öffnen
 * und wie man wählt, was von ihnen in die Notiz kommt.
 */

/* ------------------------------------------------------------------ */
/* Im Text                                                             */
/* ------------------------------------------------------------------ */

/**
 * Eine Datei im gelesenen Text: ein Bild als Bild, ein PDF als Zeile mit der
 * ersten Seite daneben. Antippen öffnet sie.
 *
 * Der Editor baut denselben Block ohne React (`renderDocInto`) – mit genau
 * diesen Klassen, siehe `noteFileStyles.ts`.
 */
export function NoteFileBlock({
  file,
  kompakt = false,
  onOpen,
}: {
  file: RichFile
  /** In der Übersicht: nur eine Zeile mit dem Namen. */
  kompakt?: boolean
  onOpen?: (file: RichFile) => void
}) {
  if (kompakt) {
    return <span className={FILE_COMPACT}>📎 {file.name}</span>
  }

  const open = onOpen
    ? (event: React.MouseEvent) => {
        // Die gelesene Notiz wird beim Antippen zum Editor – ein Griff auf die
        // Datei soll sie öffnen, nicht das Schreiben beginnen.
        event.stopPropagation()
        onOpen(file)
      }
    : undefined

  return (
    <div className={FILE_BLOCK} data-rt-file-view={file.id}>
      <FileFace file={file} onClick={open} />
    </div>
  )
}

function FileFace({
  file,
  onClick,
}: {
  file: RichFile
  onClick?: (event: React.MouseEvent) => void
}) {
  const thumbnail = useNoteThumbnail(file.id)
  // Ein Bild, das der Browser nicht zeichnen kann (HEIC vom iPhone), fällt auf
  // die Zeile mit Name und Grösse zurück, statt als leerer Rahmen dazustehen.
  const [kaputt, setKaputt] = useState(false)
  const label = `${file.name} öffnen`

  if (isImage(file) && !thumbnail.failed && !kaputt) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={file.name}
        className={FILE_IMAGE_BUTTON}
      >
        {thumbnail.url ? (
          <img
            src={thumbnail.url}
            alt={file.name}
            draggable={false}
            onError={() => setKaputt(true)}
            className={FILE_IMAGE}
          />
        ) : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={file.name}
      className={FILE_CHIP_BUTTON}
    >
      {!isImage(file) && thumbnail.url && !kaputt ? (
        <img
          src={thumbnail.url}
          alt=""
          draggable={false}
          onError={() => setKaputt(true)}
          className={FILE_CHIP_THUMB}
        />
      ) : (
        <span className={FILE_CHIP_ICON} aria-hidden="true">
          {isImage(file) ? '🖼' : '📄'}
        </span>
      )}
      <span className={FILE_CHIP_TEXT}>
        <span className={FILE_NAME}>{file.name}</span>
        <span className={FILE_META}>{fileMeta(file)}</span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Überlagerung                                                        */
/* ------------------------------------------------------------------ */

/**
 * Eine Fläche über dem Notizfenster.
 *
 * Escape schliesst nur sie: Der Griff wird abgefangen, bevor er beim Fenster
 * darunter ankommt – das hört auf dasselbe Ereignis und ginge sonst gleich mit
 * zu.
 */
function Overlay({
  onClose,
  label,
  children,
  className = 'items-end sm:items-center',
}: {
  onClose: () => void
  label: string
  children: ReactNode
  className?: string
}) {
  useFullScreenOverlay()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className={`fixed inset-0 z-50 grid justify-items-center bg-slate-900/60 p-3 ${className}`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        // min-w-0 wie im Notizfenster: Ein langer Dateiname darf die Fläche
        // nicht über den Bildschirmrand ziehen.
        className="w-full min-w-0 max-w-md"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ */
/* Betrachter                                                          */
/* ------------------------------------------------------------------ */

/**
 * Eine Datei aus der Notiz, gross – mit dem Weg zur Datei selbst.
 *
 * Ein PDF zeigt der Server als Bilder seiner Seiten: Chrome auf Android hat
 * keinen eingebauten Betrachter, in einer installierten App erst recht nicht.
 * „Öffnen" gibt die Datei dem Handy, das sie dann mit der passenden App zeigt.
 */
export function NoteFileViewer({ file, onClose }: { file: RichFile; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label={file.name} className="items-center">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{file.name}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {fileMeta(file)}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Ansicht schliessen"
            className="grid size-11 shrink-0 place-items-center rounded-full text-xl text-slate-500 dark:text-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isImage(file) ? <ImageView file={file} /> : <PdfView file={file} />}
        </div>

        <div className="flex gap-2 border-t border-black/5 p-3 dark:border-white/10">
          {/* Eine gewöhnliche Navigation darf auf die API – ein <img> nicht
              (siehe `requestBlob`). So landet die Datei im Betrachter des
              Systems statt in einem Tab, der nach dem Neuladen leer ist. */}
          <a
            href={noteFileUrl(file.id)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 text-sm font-medium dark:border-slate-700"
          >
            Öffnen
          </a>
          <a
            href={noteFileUrl(file.id, true)}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 text-sm font-medium dark:border-slate-700"
          >
            Herunterladen
          </a>
        </div>
      </div>
    </Overlay>
  )
}

function ImageView({ file }: { file: RichFile }) {
  const image = useNoteFileImage(file.id, true)
  const [kaputt, setKaputt] = useState(false)
  if (image.isError || kaputt) return <KeineVorschau />
  if (!image.url) return <Laden />
  return (
    <img
      src={image.url}
      alt={file.name}
      onError={() => setKaputt(true)}
      className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg object-contain"
    />
  )
}

function PdfView({ file }: { file: RichFile }) {
  const info = useNoteFilePreview(file.id)
  const [page, setPage] = useState(1)
  const pages = info.data?.pages ?? 0
  const bild = useNoteFilePage(file.id, page, pages > 0)
  // Die nächste Seite still vorausladen, damit das Blättern nicht hängt.
  useNoteFilePage(file.id, page + 1, page < pages)

  if (info.isPending) return <Laden />
  if (info.isError || pages === 0 || bild.isError) return <KeineVorschau />

  return (
    <div className="space-y-2">
      {bild.url ? (
        <img
          src={bild.url}
          alt={`${file.name} – Seite ${page} von ${pages}`}
          className="mx-auto max-h-[65dvh] w-auto max-w-full rounded-lg border border-slate-200 object-contain dark:border-slate-800"
        />
      ) : (
        <Laden />
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Blaettern label="Vorherige Seite" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </Blaettern>
          <span className="min-w-28 text-center text-sm tabular-nums text-slate-500 dark:text-slate-400">
            Seite {page} von {pages}
          </span>
          <Blaettern
            label="Nächste Seite"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            ›
          </Blaettern>
        </div>
      ) : null}
      {(info.data?.totalPages ?? pages) > pages ? (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Die Vorschau zeigt die ersten {pages} Seiten – alle über „Öffnen".
        </p>
      ) : null}
    </div>
  )
}

function Blaettern({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-11 place-items-center rounded-xl border border-slate-300 text-xl disabled:opacity-40 dark:border-slate-700"
    >
      {children}
    </button>
  )
}

function Laden() {
  return (
    <div className="grid h-64 place-items-center">
      <span
        className="size-6 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600 dark:border-t-transparent"
        role="status"
        aria-label="Wird geladen"
      />
    </div>
  )
}

function KeineVorschau() {
  return (
    <p className="grid h-40 place-items-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
      Eine Vorschau ist hier nicht möglich – über „Öffnen" zeigt das Handy die Datei.
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Einfügen: die Wahl und der Fortschritt                              */
/* ------------------------------------------------------------------ */

const WAHL: { art: EinfuegeArt; titel: string; text: string; zeichen: string }[] = [
  {
    art: 'datei',
    titel: 'Ganze Datei einfügen',
    text: 'Das Bild bzw. PDF steht in der Notiz – antippen öffnet es.',
    zeichen: '📎',
  },
  {
    art: 'text',
    titel: 'Text erkennen und einfügen',
    text: 'Nur der Text daraus kommt in die Notiz – zum Weiterschreiben.',
    zeichen: 'Aa',
  },
]

/**
 * Die beiden Wege als Knöpfe – im Fenster nach der Dateiauswahl und auf der
 * Seite nach dem Teilen dieselben.
 */
export function EinfuegeWahl({
  gewaehlt,
  onWahl,
  akzent = 'brand',
}: {
  /** Mit Auswahl: zwei Schalter, von denen einer gilt. Ohne: zwei Knöpfe, die gleich loslegen. */
  gewaehlt?: EinfuegeArt
  onWahl: (art: EinfuegeArt) => void
  akzent?: 'brand' | 'teal'
}) {
  const aktiv =
    akzent === 'teal'
      ? 'border-teal-600 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40'
      : 'border-brand-600 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/40'
  const zeichenText =
    akzent === 'teal' ? 'text-teal-800 dark:text-teal-200' : 'text-brand-800 dark:text-brand-200'
  const zeichenGrund =
    akzent === 'teal' ? 'bg-teal-50 dark:bg-teal-900/40' : 'bg-brand-50 dark:bg-brand-900/40'

  return (
    <div className="space-y-2" role={gewaehlt ? 'radiogroup' : undefined}>
      {WAHL.map((option) => {
        const an = gewaehlt === option.art
        return (
          <button
            key={option.art}
            type="button"
            role={gewaehlt ? 'radio' : undefined}
            aria-checked={gewaehlt ? an : undefined}
            onClick={() => onWahl(option.art)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
              an ? aktiv : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
            }`}
          >
            <span
              // Auf der hinterlegten, gewählten Karte stünde das Zeichen sonst
              // in derselben Farbe wie sein Grund.
              className={`grid size-10 shrink-0 place-items-center rounded-xl text-base font-semibold ${zeichenText} ${
                an ? 'bg-white dark:bg-slate-900' : zeichenGrund
              }`}
              aria-hidden="true"
            >
              {option.zeichen}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{option.titel}</span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                {option.text}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Nach der Dateiauswahl im Notizfenster: Wie soll sie hinein? */
export function EinfuegenDialog({
  files,
  akzent,
  onWahl,
  onAbbrechen,
}: {
  files: readonly File[]
  akzent?: 'brand' | 'teal'
  onWahl: (art: EinfuegeArt) => void
  onAbbrechen: () => void
}) {
  return (
    <Overlay onClose={onAbbrechen} label="Datei einfügen">
      <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-slate-900 shadow-xl dark:bg-slate-950 dark:text-slate-100">
        <div>
          <p className="font-semibold">Wie einfügen?</p>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-500 dark:text-slate-400">
            {files.map((file, index) => (
              <li key={index} className="truncate">
                {file.name} · {formatFileSize(file.size)}
              </li>
            ))}
          </ul>
        </div>
        <EinfuegeWahl onWahl={onWahl} akzent={akzent} />
        <button
          type="button"
          onClick={onAbbrechen}
          className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          Abbrechen
        </button>
      </div>
    </Overlay>
  )
}

/** Was gerade geschieht – mit dem Weg hinaus, falls es zu lange dauert. */
export function FortschrittAnzeige({
  fortschritt,
  onAbbrechen,
}: {
  fortschritt: Fortschritt
  onAbbrechen: () => void
}) {
  return (
    <Overlay onClose={onAbbrechen} label="Wird eingefügt" className="items-center">
      <div
        role="status"
        className="space-y-3 rounded-2xl bg-white p-5 text-center text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100"
      >
        <FortschrittText fortschritt={fortschritt} />
        <button
          type="button"
          onClick={onAbbrechen}
          className="min-h-11 w-full rounded-xl border border-slate-300 text-sm font-medium dark:border-slate-700"
        >
          Abbrechen
        </button>
      </div>
    </Overlay>
  )
}

/**
 * Die Zeilen zum Fortschritt – im Fenster und auf der Seite nach dem Teilen,
 * dort zuletzt auch fürs Speichern der Notiz.
 */
export function FortschrittText({ fortschritt }: { fortschritt: Fortschritt | 'speichert' }) {
  let titel = 'Notiz wird gespeichert …'
  let dauer: string | null = null
  if (fortschritt !== 'speichert') {
    const { art, schritt, von } = fortschritt
    const zaehler = von > 1 ? ` (${schritt} von ${von})` : ''
    titel = art === 'datei' ? `Wird hochgeladen${zaehler} …` : `Text wird erkannt${zaehler} …`
    if (art === 'text') dauer = 'Bei einem Foto dauert das bis zu einer Minute.'
  }
  return (
    <>
      <span
        className="mx-auto block size-7 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600 dark:border-t-transparent"
        aria-hidden="true"
      />
      <p className="font-medium">{titel}</p>
      {dauer ? <p className="text-sm text-slate-500 dark:text-slate-400">{dauer}</p> : null}
    </>
  )
}
