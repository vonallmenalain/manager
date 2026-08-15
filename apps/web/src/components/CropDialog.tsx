import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api } from '../lib/api'
import { useReplaceDocumentFile } from '../lib/documents'
import { useFullScreenOverlay } from '../lib/overlay'
import {
  cornerPoint,
  CROP_CORNERS,
  cropToJpeg,
  fileFromJpegs,
  FULL_CROP,
  isFullCrop,
  moveCorner,
  moveCrop,
  nearestCropCorner,
  type CropCorner,
  type CropRect,
} from '../lib/scan/pages'

/**
 * Nachträglich zuschneiden.
 *
 * Der Scanner schneidet beim Aufnehmen zu – aber nicht jedes Dokument kommt
 * über den Scanner. Ein Foto vom Zeugnis an der Wand, ein weitergeleitetes
 * Bild, ein Blatt, bei dem man den Rand erst in der Vorschau bemerkt: Bisher
 * blieb dafür nur „nochmals aufnehmen", und bei einem Bild, das man nicht mehr
 * hat, gar nichts.
 *
 * Geschnitten wird im Browser und nicht auf dem Server, und zwar dort, wo das
 * Bild ohnehin schon liegt: Die Vorschau ist geladen, das Ziehen mit dem Finger
 * braucht keine Verbindung, und erst das Ergebnis geht zurück. Ein Server, der
 * schneidet, bräuchte eine Bildbibliothek im Image – für eine Handbewegung,
 * die der Browser seit jeher kann.
 *
 * Ersetzt wird die Datei, es entsteht kein zweites Dokument: Ein
 * zugeschnittenes Blatt ist dasselbe Blatt. Deshalb die Rückfrage vorher – das
 * Original ist danach weg.
 */
export function CropDialog({
  documentId,
  title,
  mimeType,
  pages,
  sourceUrl,
  onClose,
  akzent = 'bg-brand-500',
}: {
  documentId: string
  title: string
  mimeType: string
  /** Seitenzahl bei einem PDF; bei einem Bild 1. */
  pages: number
  /**
   * Die blob:-Adresse dessen, was angezeigt wird – bei einem Bild die Datei,
   * bei einem PDF die erste gerasterte Seite. Sie ist bereits geladen, wenn
   * dieses Fenster aufgeht; ein zweites Laden wäre ein zweiter Ladebalken für
   * dasselbe Bild.
   */
  sourceUrl: string
  onClose: () => void
  /** Farbe des bestätigenden Knopfes – marineblau im Manager, petrol in der DocBase. */
  akzent?: string
}) {
  const istBild = mimeType.startsWith('image/')
  const [rect, setRect] = useState<CropRect>(FULL_CROP)
  const [working, setWorking] = useState(false)
  const [fortschritt, setFortschritt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const replace = useReplaceDocumentFile(documentId)

  useFullScreenOverlay()

  const save = useCallback(async () => {
    setNotice(null)
    setWorking(true)
    try {
      const jpegs: Blob[] = []

      if (istBild) {
        // Die blob:-Adresse liegt im Browser – das ist kein Netzzugriff,
        // sondern der Weg zurück zu den Bytes, die schon da sind.
        const original = await (await fetch(sourceUrl)).blob()
        jpegs.push(await cropToJpeg(original, rect))
      } else {
        // Bei einem PDF wird jede Seite gleich beschnitten. Zugeschnitten wird
        // die gerasterte Vorschau, denn nur sie ist ein Bild – das Ergebnis ist
        // deshalb ein PDF aus Bildern, und der Text wird danach neu erkannt.
        for (let page = 1; page <= pages; page += 1) {
          setFortschritt(`Seite ${page} von ${pages} …`)
          jpegs.push(await cropToJpeg(await api.documentPreviewPage(documentId, page), rect))
        }
      }

      setFortschritt('Wird gespeichert …')
      // Eine einzelne Seite bleibt ein Bild – dieselbe Regel wie beim Scannen.
      await replace.mutateAsync(await fileFromJpegs(jpegs, title))
      onClose()
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Das Zuschneiden hat nicht geklappt.',
      )
    } finally {
      setFortschritt(null)
      setWorking(false)
    }
  }, [documentId, istBild, onClose, pages, rect, replace, sourceUrl, title])

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-2 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <IconButton label="Zuschneiden abbrechen" onClick={onClose}>
          <path d="M6 6l12 12M18 6L6 18" />
        </IconButton>
        <p className="text-sm font-medium">Zuschneiden</p>
        <button
          onClick={() => setRect(FULL_CROP)}
          disabled={isFullCrop(rect) || working}
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-slate-200 disabled:opacity-40"
        >
          Ganzes Bild
        </button>
      </header>

      {notice ? (
        <button
          onClick={() => setNotice(null)}
          className="mx-4 mb-2 rounded-lg bg-white/15 px-3 py-2 text-center text-xs text-slate-100"
          role="status"
        >
          {notice}
        </button>
      ) : null}

      <CropStage image={sourceUrl} rect={rect} onChange={setRect} working={working} />

      <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="text-center text-xs text-slate-400">
          {working
            ? (fortschritt ?? 'Wird zugeschnitten …')
            : istBild
              ? 'Ecken ziehen oder den Ausschnitt verschieben. Das Original wird ersetzt.'
              : `Der Ausschnitt gilt für alle ${pages} Seiten. Das PDF entsteht dabei neu aus Bildern, der Text wird anschliessend neu erkannt.`}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={working}
            className="min-h-12 flex-1 rounded-xl border border-white/30 text-base font-semibold disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={() => void save()}
            disabled={working || isFullCrop(rect)}
            className={`min-h-12 flex-1 rounded-xl text-base font-semibold disabled:opacity-50 ${akzent}`}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Wie weit neben einer Ecke sie noch angefasst werden kann, in
 * Bildschirmpunkten. Wie beim Scanner grosszügig: Getroffen werden muss nicht
 * der Griff, sondern seine Nähe – sonst ist eine Ecke am Bildrand mit dem
 * Daumen kaum zu fassen.
 */
const GRAB_RADIUS = 44

/** Die Fläche, auf der gezogen wird. */
function CropStage({
  image,
  rect,
  onChange,
  working,
}: {
  image: string
  rect: CropRect
  onChange: (rect: CropRect) => void
  working: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Entweder wird eine Ecke gezogen, oder der ganze Ausschnitt verschoben.
  // null heisst: gerade nichts.
  const [dragging, setDragging] = useState<CropCorner | 'verschieben' | null>(null)
  const last = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Der Ausschnitt wird während des Ziehens laufend neu gesetzt; damit die
  // Ereignisse immer den aktuellen Stand sehen, ohne dass die Handler
  // dauernd neu entstehen.
  const rectRef = useRef(rect)
  rectRef.current = rect

  /** Berührungspunkt in Anteilen des angezeigten Bildes. */
  function toFraction(event: React.PointerEvent): { x: number; y: number } | null {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  function handleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (working) return
    const point = toFraction(event)
    const box = boxRef.current?.getBoundingClientRect()
    if (!point || !box) return

    // Der Greifradius ist in Bildschirmpunkten gedacht, gerechnet wird in
    // Anteilen. Umgerechnet wird über die kürzere Kante: So ist die Ecke auf
    // beiden Achsen mindestens so gut zu treffen wie gewünscht.
    const radius = GRAB_RADIUS / Math.min(box.width, box.height)
    const corner = nearestCropCorner(rectRef.current, point.x, point.y, radius)

    const innerhalb =
      point.x >= rectRef.current.left &&
      point.x <= rectRef.current.right &&
      point.y >= rectRef.current.top &&
      point.y <= rectRef.current.bottom

    if (!corner && !innerhalb) return

    last.current = point
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(corner ?? 'verschieben')
  }

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const point = toFraction(event)
    if (!point) return

    if (dragging === 'verschieben') {
      onChange(moveCrop(rectRef.current, point.x - last.current.x, point.y - last.current.y))
      last.current = point
      return
    }

    onChange(moveCorner(rectRef.current, dragging, point.x, point.y))
  }

  const stop = () => setDragging(null)

  return (
    <div className="grid min-h-0 flex-1 place-items-center p-4">
      {/* inline-flex: Der Rahmen legt sich exakt um das Bild, wie gross es
          nach max-height auch ausfällt. Damit ist „Anteil des Bildes" und
          „Anteil dieser Fläche" dasselbe – ohne Umrechnung über Ränder, die
          bei object-contain links und rechts entstünden. */}
      <div className="relative inline-flex max-h-full max-w-full">
        <img
          src={image}
          alt="Zuzuschneidendes Dokument"
          draggable={false}
          className="block max-h-full max-w-full select-none object-contain"
        />
        <div
          ref={boxRef}
          className="absolute inset-0"
          // touchAction: Ohne das scrollt oder zoomt die Seite beim Ziehen,
          // statt den Ausschnitt zu ändern.
          style={{ touchAction: 'none' }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
        >
          <div
            className="absolute border-2 border-white/90"
            style={{
              left: `${rect.left * 100}%`,
              top: `${rect.top * 100}%`,
              width: `${(rect.right - rect.left) * 100}%`,
              height: `${(rect.bottom - rect.top) * 100}%`,
              // Alles ausserhalb abdunkeln, ohne vier Blenden zu zeichnen.
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
            }}
          />
          {CROP_CORNERS.map((corner) => {
            const point = cornerPoint(rect, corner)
            return (
              <span
                key={corner}
                aria-hidden="true"
                className={`pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 transition-colors ${
                  dragging === corner ? 'bg-slate-300' : 'bg-white/90'
                }`}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              />
            )
          })}
        </div>

        {working ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-sm">
            Wird zugeschnitten …
          </div>
        ) : null}
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid size-11 min-h-11 place-items-center rounded-full text-white/90 transition active:bg-white/10"
    >
      <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {children}
        </g>
      </svg>
    </button>
  )
}
