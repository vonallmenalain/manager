import { useCallback, useEffect, useRef, useState } from 'react'

import {
  cameraAvailable,
  canvasToJpeg,
  drawToCanvas,
  findCorners,
  renderScan,
  SCAN_FILTER_LABELS,
  SCAN_FILTERS,
  type Quad,
  type ScanFilter,
} from '../lib/scan/pages'

/**
 * Der Dokumentenmodus der App.
 *
 * Die Kamera-App des Systems nimmt ein Foto auf – ein schräges, schattiges
 * Foto mit dem halben Küchentisch darauf. Was ein Dokument braucht, ist etwas
 * anderes: nur das Blatt, gerade von vorn, gleichmässig ausgeleuchtet. Genau
 * das passiert hier zwischen Auslöser und fertiger Seite.
 *
 * Der Ablauf in drei Schritten:
 *
 *   Kamera        – Live-Bild, ein Auslöser, sonst nichts
 *   Zuschneiden   – die erkannten Ecken zur Kontrolle, verschiebbar
 *   Verarbeiten   – entzerren, Licht ausgleichen, als Seite zurückgeben
 *
 * Der Scanner bleibt danach offen und zeigt wieder das Live-Bild: Die zweite
 * Seite eines Briefes folgt fast immer, und sie soll keinen Umweg kosten.
 */

/**
 * Auflösung, mit der das aufgenommene Bild weiterverarbeitet wird.
 *
 * Nicht kleiner: Nach dem Zuschneiden bleibt von der Bildbreite oft nur zwei
 * Drittel übrig, und darunter wird die Texterkennung merklich schlechter.
 * Nicht grösser: Jeder Bildpunkt kostet in der Entzerrung Rechenzeit, die auf
 * dem Handy zwischen Auslöser und Vorschau spürbar wird.
 */
const CAPTURE_MAX_EDGE = 2600

interface Captured {
  canvas: HTMLCanvasElement
  url: string
  width: number
  height: number
}

interface DocumentScannerProps {
  /** Wie viele Seiten bereits gesammelt sind. */
  pageCount: number
  onCapture: (page: Blob) => void
  onClose: () => void
  /** Kamera nicht nutzbar – stattdessen die Kamera-App des Systems öffnen. */
  onFallback: () => void
}

export function DocumentScanner({
  pageCount,
  onCapture,
  onClose,
  onFallback,
}: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [quad, setQuad] = useState<Quad | null>(null)
  const [filter, setFilter] = useState<ScanFilter>('farbe')
  const [working, setWorking] = useState(false)
  // Zwei Arten von Fehler, bewusst getrennt: `error` heisst, dass die Kamera
  // gar nicht läuft – dann hilft nur noch der Weg über die Kamera-App.
  // `notice` ist ein Missgeschick beim Aufnehmen oder Zuschneiden; dabei darf
  // die schon gemachte Aufnahme nicht verlorengehen.
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Hochzählen startet die Kamera neu – der Weg zurück nach einer abgelehnten
  // oder von einer anderen App belegten Kamera.
  const [attempt, setAttempt] = useState(0)

  // Die Kamera läuft, solange der Scanner offen ist – auch während des
  // Zuschneidens. Sie bei jeder Seite neu zu starten kostete jedes Mal eine
  // knappe Sekunde, in der man auf ein schwarzes Bild schaut.
  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null

    async function start() {
      if (!cameraAvailable()) {
        setError('Dieser Browser gibt keine Kamera frei.')
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // 'environment' ist die Rückkamera. Als Wunsch und nicht als
          // Bedingung formuliert: Ein Gerät mit nur einer Kamera soll die
          // nehmen, die es hat, statt die Anfrage abzulehnen.
          // Die hohe Wunschauflösung holt heraus, was die Kamera hergibt –
          // A4 quer über 2160 Zeilen liest die Texterkennung sicher, über
          // 1080 nur mit Glück.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        })
      } catch (cause) {
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Die Kamera ist für diese Seite nicht freigegeben.'
            : 'Die Kamera liess sich nicht öffnen.',
        )
        return
      }

      if (stopped) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        try {
          await video.play()
        } catch {
          // Autostart abgelehnt – das Bild erscheint, sobald der Nutzer die
          // Seite berührt. Kein Grund für eine Fehlermeldung.
        }
      }
    }

    void start()

    return () => {
      stopped = true
      if (stream) for (const track of stream.getTracks()) track.stop()
    }
  }, [attempt])

  // Die Vorschau des aufgenommenen Bildes wieder freigeben, sobald sie durch
  // eine neue ersetzt wird oder der Scanner schliesst.
  useEffect(() => {
    if (!captured) return
    return () => URL.revokeObjectURL(captured.url)
  }, [captured])

  const shoot = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) {
      setNotice('Das Kamerabild ist noch nicht da. Einen Moment, dann nochmals.')
      return
    }

    setNotice(null)
    setWorking(true)
    try {
      const canvas = drawToCanvas(video, video.videoWidth, video.videoHeight, CAPTURE_MAX_EDGE)
      const corners = findCorners(canvas)
      const preview = await canvasToJpeg(canvas, 0.9)

      setQuad(corners)
      setCaptured({
        canvas,
        url: URL.createObjectURL(preview),
        width: canvas.width,
        height: canvas.height,
      })
    } catch {
      setNotice('Die Aufnahme hat nicht geklappt. Bitte nochmals versuchen.')
    } finally {
      setWorking(false)
    }
  }, [])

  const accept = useCallback(async () => {
    if (!captured || !quad) return

    setNotice(null)
    setWorking(true)
    // Einen Moment ans Zeichnen abgeben, sonst friert die Anzeige ein, bevor
    // der Hinweis „Wird aufbereitet" überhaupt erscheint.
    await new Promise((resolve) => setTimeout(resolve, 0))

    try {
      onCapture(await renderScan(captured.canvas, quad, filter))
      setCaptured(null)
      setQuad(null)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Die Seite liess sich nicht aufbereiten.')
    } finally {
      setWorking(false)
    }
  }, [captured, quad, filter, onCapture])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-2 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <IconButton label="Scanner schliessen" onClick={onClose}>
          <path d="M6 6l12 12M18 6L6 18" />
        </IconButton>
        <p className="text-sm font-medium">
          {captured
            ? 'Ränder prüfen'
            : pageCount === 0
              ? 'Dokument scannen'
              : `Seite ${pageCount + 1}`}
        </p>
        <div className="w-11">
          {pageCount > 0 && !captured ? (
            <button
              onClick={onClose}
              className="min-h-11 rounded-full px-3 text-sm font-semibold text-brand-200"
            >
              Fertig
            </button>
          ) : null}
        </div>
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

      {error ? (
        <ErrorPanel
          message={error}
          onRetry={() => {
            setError(null)
            setAttempt((count) => count + 1)
          }}
          onFallback={onFallback}
        />
      ) : captured && quad ? (
        <CropStage
          captured={captured}
          quad={quad}
          onQuadChange={setQuad}
          filter={filter}
          onFilterChange={setFilter}
          working={working}
          onRetake={() => {
            setCaptured(null)
            setQuad(null)
          }}
          onAccept={() => void accept()}
        />
      ) : (
        <CameraStage
          videoRef={videoRef}
          pageCount={pageCount}
          working={working}
          onShoot={() => void shoot()}
        />
      )}
    </div>
  )
}

function CameraStage({
  videoRef,
  pageCount,
  working,
  onShoot,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  pageCount: number
  working: boolean
  onShoot: () => void
}) {
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          // playsInline: Ohne das Attribut spielt iOS das Kamerabild
          // bildschirmfüllend im eigenen Player ab statt in der Seite.
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-contain"
        />
        <p className="absolute inset-x-0 bottom-2 text-center text-xs text-slate-300">
          Das ganze Blatt ins Bild nehmen – die Ränder findet die App selbst.
        </p>
      </div>

      <div className="flex items-center justify-center gap-6 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <span className="w-16 text-sm tabular-nums text-slate-400">
          {pageCount > 0 ? `${pageCount} ${pageCount === 1 ? 'Seite' : 'Seiten'}` : ''}
        </span>
        <button
          onClick={onShoot}
          disabled={working}
          aria-label="Aufnehmen"
          className="grid size-18 place-items-center rounded-full border-4 border-white/80 transition active:scale-95 disabled:opacity-50"
        >
          <span className="size-14 rounded-full bg-white" />
        </button>
        <span className="w-16" />
      </div>
    </>
  )
}

/**
 * Die Kontrolle vor dem Übernehmen.
 *
 * Die erkannten Ecken sind ein Vorschlag. Ein Blatt auf hellem Untergrund,
 * ein Schatten quer über der Kante, ein zweites Papier daneben – es gibt genug
 * Fälle, in denen die Erkennung danebenliegt. Sie hier zurechtzuziehen dauert
 * zwei Sekunden; ein schief beschnittener Scan im Archiv bleibt für immer.
 */
function CropStage({
  captured,
  quad,
  onQuadChange,
  filter,
  onFilterChange,
  working,
  onRetake,
  onAccept,
}: {
  captured: Captured
  quad: Quad
  onQuadChange: (quad: Quad) => void
  filter: ScanFilter
  onFilterChange: (filter: ScanFilter) => void
  working: boolean
  onRetake: () => void
  onAccept: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  // Wie viele Bildpunkte des Fotos auf einen Bildschirmpunkt kommen. Bestimmt
  // die Grösse der Griffe: Sie sollen unabhängig von der Auflösung des Fotos
  // immer gleich gross unter dem Daumen liegen.
  const [pixelsPerScreenPoint, setPixelsPerScreenPoint] = useState(1)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const scale = Math.min(rect.width / captured.width, rect.height / captured.height)
      if (scale > 0) setPixelsPerScreenPoint(1 / scale)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [captured.width, captured.height])

  /**
   * Rechnet einen Berührungspunkt in Bildpunkte des Fotos um.
   *
   * Das SVG füllt seinen Kasten nicht aus: Es zeigt das Foto mit
   * preserveAspectRatio zentriert, genau wie das <img> darunter. Die Ränder
   * links und rechts (oder oben und unten) müssen deshalb abgezogen werden,
   * sonst wandert jede Ecke beim Anfassen ein Stück zur Seite.
   */
  function toImagePoint(event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / captured.width, rect.height / captured.height)
    const offsetX = (rect.width - captured.width * scale) / 2
    const offsetY = (rect.height - captured.height * scale) / 2

    return {
      x: Math.min(Math.max((event.clientX - rect.left - offsetX) / scale, 0), captured.width),
      y: Math.min(Math.max((event.clientY - rect.top - offsetY) / scale, 0), captured.height),
    }
  }

  function moveCorner(event: React.PointerEvent<SVGSVGElement>) {
    if (dragging === null) return
    const point = toImagePoint(event)
    const next = [...quad] as Quad
    next[dragging] = point
    onQuadChange(next)
  }

  const handleRadius = 20 * pixelsPerScreenPoint
  const strokeWidth = 2 * pixelsPerScreenPoint
  const polygon = quad.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <img
          src={captured.url}
          alt="Aufgenommene Seite"
          className="absolute inset-0 h-full w-full object-contain"
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${captured.width} ${captured.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          // touchAction: Ohne das scrollt oder zoomt die Seite beim Ziehen,
          // statt die Ecke zu verschieben.
          style={{ touchAction: 'none' }}
          onPointerMove={moveCorner}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
        >
          <polygon
            points={polygon}
            fill="rgba(86, 140, 192, 0.25)"
            stroke="#8ab0d6"
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          {quad.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={handleRadius}
              fill={dragging === index ? '#8ab0d6' : 'rgba(255,255,255,0.9)'}
              stroke="#1e3a5f"
              strokeWidth={strokeWidth}
              onPointerDown={(event) => {
                event.preventDefault()
                svgRef.current?.setPointerCapture(event.pointerId)
                setDragging(index)
              }}
            />
          ))}
        </svg>

        {working ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-sm">
            Wird aufbereitet …
          </div>
        ) : null}
      </div>

      <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex gap-1 rounded-xl bg-white/10 p-1">
          {SCAN_FILTERS.map((option) => (
            <button
              key={option}
              onClick={() => onFilterChange(option)}
              aria-pressed={filter === option}
              className={`min-h-11 flex-1 rounded-lg text-sm font-medium transition ${
                filter === option ? 'bg-white text-slate-900' : 'text-slate-200'
              }`}
            >
              {SCAN_FILTER_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onRetake}
            disabled={working}
            className="min-h-12 flex-1 rounded-xl border border-white/30 text-base font-semibold disabled:opacity-50"
          >
            Neu aufnehmen
          </button>
          <button
            onClick={onAccept}
            disabled={working}
            className="min-h-12 flex-1 rounded-xl bg-brand-500 text-base font-semibold disabled:opacity-50"
          >
            Übernehmen
          </button>
        </div>
      </div>
    </>
  )
}

/**
 * Ohne Kamerafreigabe ist der Scanner am Ende – aber der Weg zum Dokument
 * nicht: Die Kamera-App des Systems braucht keine Freigabe der Seite.
 */
function ErrorPanel({
  message,
  onRetry,
  onFallback,
}: {
  message: string
  onRetry: () => void
  onFallback: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-sm text-slate-300">{message}</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          onClick={onFallback}
          className="min-h-12 rounded-xl bg-brand-500 text-base font-semibold"
        >
          Kamera-App öffnen
        </button>
        <button onClick={onRetry} className="min-h-12 rounded-xl border border-white/30 text-base">
          Nochmals versuchen
        </button>
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
