import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api } from '../lib/api'
import { useReplaceDocumentFile } from '../lib/documents'
import { useEscape, useFullScreenOverlay } from '../lib/overlay'
import {
  containsPoint,
  CROP_HANDLES,
  cropPixels,
  cropToJpeg,
  fileFromJpegs,
  fitInside,
  FULL_CROP,
  handlePoint,
  isFullCrop,
  moveCrop,
  moveHandle,
  nearestCropHandle,
  type Box,
  type CropHandle,
  type CropRect,
  type Point,
  type Size,
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
  const [natural, setNatural] = useState<Size | null>(null)
  const [working, setWorking] = useState(false)
  const [fortschritt, setFortschritt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const replace = useReplaceDocumentFile(documentId)

  useFullScreenOverlay()
  // Escape bricht ab – aber nicht mitten im Speichern, sonst bliebe eine
  // halb geschriebene Datei zurück. Über die Referenz bleibt der Handler
  // derselbe, während gezogen wird: Sonst hinge sich die Tastenüberwachung
  // bei jeder Fingerbewegung neu an das Fenster.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEscape(
    !working,
    useCallback(() => closeRef.current(), []),
  )

  const save = useCallback(async () => {
    if (isFullCrop(rect)) {
      setNotice('Noch kein Ausschnitt gewählt – zieh die Ränder nach innen.')
      return
    }

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
      setNotice(error instanceof Error ? error.message : 'Das Zuschneiden hat nicht geklappt.')
    } finally {
      setFortschritt(null)
      setWorking(false)
    }
  }, [documentId, istBild, onClose, pages, rect, replace, sourceUrl, title])

  // Was am Ende herauskommt – in Bildpunkten des angezeigten Bildes. Bei einem
  // PDF ist das die gerasterte Seite und damit genau die Auflösung, die
  // gespeichert wird.
  const ergebnis = natural ? cropPixels(rect, natural.width, natural.height) : null

  return createPortal(
    // overflow-hidden: Nichts in diesem Fenster darf über seinen Rand
    // hinauswachsen. Genau das ist vorher passiert – ein hochauflösendes Bild
    // stand in voller Grösse da und legte sich über die Knöpfe.
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-950 text-white">
      {/* z-10 und eigener Hintergrund: Die Bedienfläche liegt über der
          Bildfläche. Absolut positionierte Kinder – und die Abdunklung des
          Ausschnitts ist eines – werden sonst über gewöhnlichen Geschwistern
          gezeichnet, egal in welcher Reihenfolge sie im Dokument stehen. */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-2 bg-slate-950 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <IconButton label="Zuschneiden abbrechen" onClick={onClose} disabled={working}>
          <path d="M6 6l12 12M18 6L6 18" />
        </IconButton>
        <p className="text-sm font-medium">Zuschneiden</p>
        <button
          onClick={() => setRect(FULL_CROP)}
          disabled={isFullCrop(rect) || working}
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-slate-200 disabled:opacity-40"
        >
          Zurücksetzen
        </button>
      </header>

      {notice ? (
        <button
          onClick={() => setNotice(null)}
          className="relative z-10 mx-4 mb-2 shrink-0 rounded-lg bg-white/15 px-3 py-2 text-center text-xs text-slate-100"
          role="status"
        >
          {notice}
        </button>
      ) : null}

      <CropStage
        image={sourceUrl}
        rect={rect}
        onChange={setRect}
        natural={natural}
        onNatural={setNatural}
        working={working}
      />

      <div className="relative z-10 shrink-0 space-y-3 bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="text-center text-xs text-slate-400">
          {working ? (
            (fortschritt ?? 'Wird zugeschnitten …')
          ) : (
            <>
              Ränder und Ecken ziehen, Ausschnitt verschieben. Das Original wird ersetzt.
              {ergebnis && !isFullCrop(rect) ? (
                <span className="mt-0.5 block tabular-nums text-slate-500">
                  Ergebnis: {ergebnis.width} × {ergebnis.height} Punkte
                </span>
              ) : null}
              {!istBild ? (
                <span className="mt-0.5 block text-slate-500">
                  Gilt für alle {pages} Seiten. Das PDF entsteht dabei neu aus Bildern, der Text
                  wird anschliessend neu erkannt.
                </span>
              ) : null}
            </>
          )}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={working}
            className="min-h-12 flex-1 rounded-xl border border-white/30 text-base font-semibold disabled:opacity-50"
          >
            Abbrechen
          </button>
          {/* Nicht deaktiviert, solange kein Ausschnitt gewählt ist: Ein Knopf,
              der sich nicht drücken lässt, sagt nicht warum. Der Griff darauf
              erklärt es stattdessen. */}
          <button
            onClick={() => void save()}
            disabled={working}
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
 * Wie weit neben einem Griff er noch angefasst werden kann, in
 * Bildschirmpunkten.
 *
 * Grosszügig, und das ist der Punkt: Getroffen werden muss nicht der Griff,
 * sondern seine Nähe. 44 Punkte sind die Fläche, die ein Daumen abdeckt –
 * darunter wird das Anfassen zur Glückssache.
 */
const GRAB_RADIUS = 44

/**
 * Abstand zwischen Bild und Rand der Fläche, in Bildschirmpunkten.
 *
 * Auf diesem Rand liegt die äussere Hälfte jedes Griffs, der auf der Bildkante
 * sitzt. Ohne ihn wäre eine Ecke nur von innen zu fassen – auf dem Handy genau
 * dort, wo das Wischen vom Rand die Bewegung übernimmt, bevor die Seite sie zu
 * sehen bekommt.
 */
const STAGE_MARGIN = 28

/** Der Mauszeiger sagt am Bildschirm, was ein Ziehen hier bewirken würde. */
const ZEIGER: Record<CropHandle | 'verschieben' | 'nichts', string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  verschieben: 'move',
  nichts: 'default',
}

/** Die Fläche, auf der gezogen wird. */
function CropStage({
  image,
  rect,
  onChange,
  natural,
  onNatural,
  working,
}: {
  image: string
  rect: CropRect
  onChange: (rect: CropRect) => void
  natural: Size | null
  onNatural: (size: Size) => void
  working: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 })
  // Entweder wird ein Griff gezogen, oder der ganze Ausschnitt verschoben.
  // null heisst: gerade nichts.
  const [dragging, setDragging] = useState<CropHandle | 'verschieben' | null>(null)
  // Was ein Griff an dieser Stelle bewirken würde – nur für den Mauszeiger.
  // Am Handy ohne Wirkung, am Bildschirm der Unterschied zwischen „da kann
  // man ziehen" und Herumprobieren.
  const [hover, setHover] = useState<CropHandle | 'verschieben' | null>(null)
  const last = useRef<Point>({ x: 0, y: 0 })

  // Der Ausschnitt wird während des Ziehens laufend neu gesetzt; über die
  // Referenz sehen die Ereignisse immer den aktuellen Stand, ohne dass die
  // Handler bei jeder Bewegung neu entstehen.
  const rectRef = useRef(rect)
  rectRef.current = rect

  // Die Fläche ausmessen, statt dem Browser eine Prozentangabe zu überlassen:
  // Anzeige, Bedienfläche und Rechnung bekommen damit exakt dieselben Masse.
  useEffect(() => {
    const element = frameRef.current
    if (!element) return

    const messen = () => {
      const box = element.getBoundingClientRect()
      setFrame({ width: box.width, height: box.height })
    }

    messen()
    const observer = new ResizeObserver(messen)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bild: Box | null =
    natural && frame.width > 0 && frame.height > 0
      ? fitInside(natural, frame, STAGE_MARGIN)
      : null

  const bildRef = useRef(bild)
  bildRef.current = bild

  /**
   * Berührungspunkt in Anteilen des angezeigten Bildes.
   *
   * Bewusst ohne Begrenzung auf 0 bis 1: Auch eine Berührung neben dem Bild –
   * auf dem Rand ringsum – ist eine gültige Angabe, welcher Griff gemeint ist.
   * Begrenzt wird erst der Griff selbst.
   */
  function toFraction(event: React.PointerEvent): Point | null {
    const box = frameRef.current?.getBoundingClientRect()
    const gezeigt = bildRef.current
    if (!box || !gezeigt) return null

    return {
      x: (event.clientX - box.left - gezeigt.left) / gezeigt.width,
      y: (event.clientY - box.top - gezeigt.top) / gezeigt.height,
    }
  }

  /**
   * Jeder Griff auf diese Fläche bewirkt etwas – das ist Absicht.
   *
   * Nah an einem Griff: dieser Griff. Innerhalb des Ausschnitts: verschieben.
   * Sonst: der nächstgelegene Griff, wie weit er auch weg ist. Ausserhalb des
   * Ausschnitts gibt es nichts anderes zu tun, als die nächste Kante hierher
   * zu ziehen – und ein Tippen, das gar nichts bewirkt, fühlt sich kaputt an.
   */
  function was(point: Point, gezeigt: Box): CropHandle | 'verschieben' | null {
    const nah = nearestCropHandle(rectRef.current, point, gezeigt, GRAB_RADIUS)
    if (nah) return nah
    if (containsPoint(rectRef.current, point)) return 'verschieben'
    return nearestCropHandle(rectRef.current, point, gezeigt, Infinity)
  }

  function handleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (working) return
    const point = toFraction(event)
    const gezeigt = bildRef.current
    if (!point || !gezeigt) return

    const gegriffen = was(point, gezeigt)
    if (!gegriffen) return

    last.current = point
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(gegriffen)
  }

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = toFraction(event)
    if (!point) return

    if (!dragging) {
      const gezeigt = bildRef.current
      // Gleicher Wert heisst kein neues Zeichnen – React bricht dann ab.
      setHover(gezeigt && !working ? was(point, gezeigt) : null)
      return
    }

    if (dragging === 'verschieben') {
      onChange(moveCrop(rectRef.current, point.x - last.current.x, point.y - last.current.y))
      last.current = point
      return
    }

    onChange(moveHandle(rectRef.current, dragging, point.x, point.y))
  }

  const stop = () => setDragging(null)

  return (
    // overflow-hidden hält die Abdunklung des Ausschnitts in dieser Fläche;
    // touch-none, damit das Ziehen nicht die Seite scrollt.
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden"
      style={{ cursor: ZEIGER[dragging ?? hover ?? 'nichts'] }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerLeave={() => setHover(null)}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      <img
        src={image}
        alt="Zuzuschneidendes Dokument"
        draggable={false}
        onLoad={(event) =>
          onNatural({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        className="absolute select-none"
        // Ausgerechnete Masse statt max-height in Prozent: Letztere hängt an
        // der Höhe des Elternteils, die dieses erst vom Bild bekommt – ein
        // Zirkelschluss, den der Browser auflöst, indem er die Begrenzung
        // fallen lässt.
        style={
          bild
            ? { left: bild.left, top: bild.top, width: bild.width, height: bild.height }
            : { opacity: 0, left: 0, top: 0 }
        }
      />

      {bild ? (
        <div
          className="absolute"
          style={{ left: bild.left, top: bild.top, width: bild.width, height: bild.height }}
        >
          <div
            className="absolute border-2 border-white/90"
            style={{
              left: `${rect.left * 100}%`,
              top: `${rect.top * 100}%`,
              width: `${(rect.right - rect.left) * 100}%`,
              height: `${(rect.bottom - rect.top) * 100}%`,
              // Alles ausserhalb abdunkeln, ohne vier Blenden zu zeichnen. Der
              // Überstand wird von der Fläche oben abgeschnitten.
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
            }}
          />

          {CROP_HANDLES.map((handle) => {
            const at = handlePoint(rect, handle)
            const waagrecht = handle === 'n' || handle === 's'
            const senkrecht = handle === 'e' || handle === 'w'

            return (
              <span
                key={handle}
                aria-hidden="true"
                // pointer-events-none: Angefasst wird die ganze Fläche, nicht
                // der Griff. Ein Griff, der nur auf sich selbst hört, ist genau
                // dann nicht zu bedienen, wenn man ihn am dringendsten braucht.
                className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 shadow ${
                  dragging === handle ? 'bg-teal-300' : 'bg-white'
                }`}
                style={{
                  left: `${at.x * 100}%`,
                  top: `${at.y * 100}%`,
                  width: waagrecht ? 36 : senkrecht ? 10 : 20,
                  height: senkrecht ? 36 : waagrecht ? 10 : 20,
                }}
              />
            )
          })}
        </div>
      ) : (
        <span
          className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-600 border-t-transparent"
          role="status"
          aria-label="Bild wird geladen"
        />
      )}

      {working ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-sm">
          Wird zugeschnitten …
        </div>
      ) : null}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-11 min-h-11 place-items-center rounded-full text-white/90 transition active:bg-white/10 disabled:opacity-40"
    >
      <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {children}
        </g>
      </svg>
    </button>
  )
}
