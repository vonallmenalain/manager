import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useFullScreenOverlay } from '../lib/overlay'
import {
  cameraAvailable,
  canvasToJpeg,
  capturePhoto,
  DEFAULT_SCAN_FILTER,
  drawToCanvas,
  findCorners,
  nearestCorner,
  renderScan,
  SCAN_FILTER_LABELS,
  SCAN_FILTERS,
  type Point,
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
 * Danach schliesst der Scanner und die Seite landet im Stapel. Nicht gleich
 * wieder in den Sucher, obwohl das einen Tap sparen würde: Nach einer Seite
 * ist das Wahrscheinlichste, dass sie es war. Und wer weitermacht, bekommt
 * über „Weitere Seite" eine frisch geöffnete Kamera – auf manchen
 * Android-Geräten der einzige Weg zu einem Live-Bild, nachdem einmal ein
 * Standbild aufgenommen wurde.
 *
 * Die Fläche hängt über ein Portal direkt am <body> und nicht in der
 * Dokumentenliste, aus der sie geöffnet wurde: Sonst teilt sie sich den
 * Stapel mit der Navigationsleiste am unteren Rand, die dann durchscheint.
 */

/**
 * Auflösung, mit der das aufgenommene Bild weiterverarbeitet wird.
 *
 * Nicht kleiner: Nach dem Zuschneiden bleibt von der Bildbreite oft nur zwei
 * Drittel übrig, und darunter wird die Texterkennung merklich schlechter.
 * Nicht grösser: Ein Bild dieser Kantenlänge belegt beim Entzerren rund 27 MB
 * Arbeitsspeicher, und das Standbild einer heutigen Kamera hätte das Doppelte –
 * mehr, als eine fertige Seite (2000 Bildpunkte) je gebrauchen kann.
 */
const CAPTURE_MAX_EDGE = 3000

/**
 * Auflösung der Vorschau beim Zuschneiden.
 *
 * Sie wird nur auf dem Bildschirm angeschaut, nie weiterverarbeitet – die
 * Ecken rechnet die App in den Koordinaten der vollen Aufnahme. Ein
 * gleichgrosses Vorschaubild zu kodieren würde den Auslöser nur verzögern.
 */
const PREVIEW_MAX_EDGE = 1400

/** Sichtbare Grösse eines Eckgriffs, in Bildschirmpunkten. */
const HANDLE_RADIUS = 20

/**
 * Abstand zwischen Foto und Rand der Anzeige, in Bildschirmpunkten.
 *
 * Ein Blatt, das über den Sucher hinausragte, hat seine Ecken auf dem Bildrand
 * – ohne diesen Rahmen lägen deren Griffe halb ausserhalb des Bildschirms, dort
 * wo bei einem Mobiltelefon das Wischen vom Rand die Bewegung übernimmt, bevor
 * die Seite sie zu sehen bekommt. Der Rahmen ist breiter als ein Griff, damit
 * auch ein Griff genau auf der Kante noch vollständig innerhalb liegt.
 */
const CROP_MARGIN = HANDLE_RADIUS + 8

/**
 * Wie weit neben einer Ecke sie noch angefasst werden kann, in Bildschirmpunkten.
 *
 * Getroffen werden muss nicht der Kreis, sondern nur seine Nähe. Das ist der
 * eigentliche Grund, weshalb sich auch eine Ecke am äussersten Bildrand
 * zurechtziehen lässt: Angefasst wird sie mit einem Tippen weiter innen, weg
 * vom Rand. Bei vier Ecken auf einer Bildschirmbreite ist so viel Umgebung
 * unbedenklich – näher als hundert Punkte liegen sie selten beieinander, und
 * eine andere Bewegung gibt es auf dieser Fläche nicht.
 */
const GRAB_RADIUS = 44

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
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [streamReady, setStreamReady] = useState(false)
  // Sobald ein Gerät beim Standbild einmal nicht mitspielt, wird es nicht bei
  // jeder weiteren Seite erneut gefragt – die Wartezeit hätte man sonst immer.
  const stillPhotoRef = useRef(true)
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [quad, setQuad] = useState<Quad | null>(null)
  const [filter, setFilter] = useState<ScanFilter>(DEFAULT_SCAN_FILTER)
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

  useFullScreenOverlay()

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

      streamRef.current = stream
      trackRef.current = stream.getVideoTracks()[0] ?? null
      setStreamReady(true)

      // Endet der Strom von sich aus – weil eine andere App die Kamera
      // übernimmt oder das Gerät sie nach einer Standbildaufnahme neu
      // einrichtet –, wird er neu angefordert, statt ein schwarzes Bild
      // stehen zu lassen. track.stop() löst dieses Ereignis nicht aus, das
      // Aufräumen unten kann also keine Schleife anstossen.
      trackRef.current?.addEventListener('ended', () => {
        if (!stopped) setAttempt((count) => count + 1)
      })
    }

    void start()

    return () => {
      stopped = true
      streamRef.current = null
      trackRef.current = null
      setStreamReady(false)
      if (stream) for (const track of stream.getTracks()) track.stop()
    }
  }, [attempt])

  /**
   * Hängt den Kamerastrom an das Videoelement.
   *
   * Bewusst getrennt vom Anfordern der Kamera und abhängig von `captured`:
   * Während des Zuschneidens ist das Videoelement nicht im Dokument, und
   * danach kommt ein neues, leeres zurück. Genau das war der Grund, weshalb
   * ab der zweiten Seite nur noch ein schwarzes Bild zu sehen war – der Strom
   * lief weiter, hing aber am alten, längst weggeräumten Element.
   */
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return

    if (video.srcObject !== stream) video.srcObject = stream
    // Autostart abgelehnt: Das Bild erscheint, sobald jemand die Seite
    // berührt – kein Grund für eine Fehlermeldung.
    void video.play().catch(() => undefined)
  }, [streamReady, captured])

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
      // Erst das Standbild in voller Auflösung versuchen; kommt keines,
      // bleibt es beim Bild aus dem Live-Strom.
      const track = trackRef.current
      let still: HTMLCanvasElement | null = null
      if (track && stillPhotoRef.current) {
        still = await capturePhoto(track, CAPTURE_MAX_EDGE, video.videoWidth * video.videoHeight)
        if (!still) stillPhotoRef.current = false
      }

      const canvas =
        still ?? drawToCanvas(video, video.videoWidth, video.videoHeight, CAPTURE_MAX_EDGE)
      const corners = findCorners(canvas)
      const preview = await canvasToJpeg(
        drawToCanvas(canvas, canvas.width, canvas.height, PREVIEW_MAX_EDGE),
        0.85,
      )

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
      // Zurück zum Stapel statt gleich wieder in den Sucher: Nach einer Seite
      // ist das Wahrscheinlichste, dass sie es war. Wer weitermachen will,
      // tippt dort auf „Weitere Seite" – und bekommt damit eine frisch
      // geöffnete Kamera, was auf manchen Geräten der einzige Weg zu einem
      // Live-Bild nach einer Standbildaufnahme ist.
      onClose()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Die Seite liess sich nicht aufbereiten.')
    } finally {
      setWorking(false)
    }
  }, [captured, quad, filter, onCapture, onClose])

  return createPortal(
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
            // Die Kamera neu anfordern statt den bestehenden Strom wieder
            // anzuzeigen: Nach einer Standbildaufnahme liefert er auf manchen
            // Android-Geräten kein Bild mehr, und man schaut ins Schwarze.
            // Der Neustart kostet einen Sekundenbruchteil.
            setAttempt((count) => count + 1)
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
    </div>,
    document.body,
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
          autoPlay
          className="absolute inset-0 h-full w-full object-contain"
        />
        <p className="absolute inset-x-0 bottom-2 text-center text-xs text-slate-300">
          {working
            ? 'Bild wird aufgenommen – bitte ruhig halten …'
            : 'Das ganze Blatt ins Bild nehmen – die Ränder findet die App selbst.'}
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
  // Der Abstand zwischen Berührung und Ecke im Moment des Anfassens. Er bleibt
  // während des Ziehens erhalten: Eine Ecke, die man bewusst etwas weiter innen
  // angefasst hat, soll nicht unter den Finger springen und dabei den Beschnitt
  // verschieben, den man gerade nur prüfen wollte.
  const grabOffset = useRef<Point>({ x: 0, y: 0 })
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
   * Gemessen wird am SVG und nicht am angefassten Element: Bedient wird die
   * ganze Fläche samt Rahmen, gerechnet wird im Foto. Und das SVG füllt seinen
   * Kasten nicht aus – es zeigt das Foto mit preserveAspectRatio zentriert,
   * genau wie das <img> darunter. Die Ränder links und rechts (oder oben und
   * unten) müssen deshalb abgezogen werden, sonst wandert jede Ecke beim
   * Anfassen ein Stück zur Seite.
   *
   * Bewusst ohne Begrenzung auf das Foto: Auch eine Berührung daneben – im
   * Rahmen um das Bild – ist eine gültige Angabe, an welcher Ecke gezogen wird.
   * Begrenzt wird erst die Ecke selbst.
   */
  function toImagePoint(event: React.PointerEvent<HTMLDivElement>): Point | null {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null

    const scale = Math.min(rect.width / captured.width, rect.height / captured.height)
    // Noch nicht ausgemessen – dann gibt es auch keine Ecke zu treffen.
    if (!(scale > 0)) return null

    const offsetX = (rect.width - captured.width * scale) / 2
    const offsetY = (rect.height - captured.height * scale) / 2

    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    }
  }

  /**
   * Hält eine Ecke innerhalb des Fotos.
   *
   * Daneben gibt es keine Bildpunkte, die sich entzerren liessen – der Scan
   * hätte dort einen schwarzen Keil. Begrenzt wird die Ecke und nicht der
   * Finger: Sonst käme eine Ecke, die genau auf der Bildkante liegen soll, nur
   * mit einem Finger genau auf derselben Kante dorthin.
   */
  function clampToImage(point: Point): Point {
    return {
      x: Math.min(Math.max(point.x, 0), captured.width),
      y: Math.min(Math.max(point.y, 0), captured.height),
    }
  }

  /**
   * Fasst die Ecke an, die der Berührung am nächsten liegt.
   *
   * Die Berührung nimmt die ganze Fläche an und nicht der Kreis: Ein Griff, der
   * nur auf sich selbst hört, ist genau dann nicht mehr zu bedienen, wenn man
   * ihn am dringendsten braucht – am Bildrand, wo der Daumen ihn kaum mittig
   * trifft und das Betriebssystem beim Rand mitreden will. Zur Fläche gehört
   * auch der Rahmen um das Foto: Dort liegt die äussere Hälfte eines Griffs,
   * der auf der Bildkante sitzt.
   */
  function grabCorner(event: React.PointerEvent<HTMLDivElement>) {
    const point = toImagePoint(event)
    if (!point) return

    const nearest = nearestCorner(quad, point, GRAB_RADIUS * pixelsPerScreenPoint)
    if (nearest === null) return

    const corner = quad[nearest] as Point
    grabOffset.current = { x: corner.x - point.x, y: corner.y - point.y }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(nearest)
  }

  function moveCorner(event: React.PointerEvent<HTMLDivElement>) {
    if (dragging === null) return
    const point = toImagePoint(event)
    if (!point) return

    const next = [...quad] as Quad
    next[dragging] = clampToImage({
      x: point.x + grabOffset.current.x,
      y: point.y + grabOffset.current.y,
    })
    onQuadChange(next)
  }

  const handleRadius = HANDLE_RADIUS * pixelsPerScreenPoint
  const strokeWidth = 2 * pixelsPerScreenPoint
  const polygon = quad.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <>
      {/* Die Berührung nimmt diese Fläche an, samt Rahmen – nicht das SVG
          darin: Ein Griff auf der Bildkante liegt zur Hälfte im Rahmen, und was
          dort ankommt, gehört genauso zum Zurechtziehen. */}
      <div
        className="relative min-h-0 flex-1"
        style={{
          padding: CROP_MARGIN,
          // touchAction: Ohne das scrollt oder zoomt die Seite beim Ziehen,
          // statt die Ecke zu verschieben.
          touchAction: 'none',
        }}
        onPointerDown={grabCorner}
        onPointerMove={moveCorner}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        onLostPointerCapture={() => setDragging(null)}
      >
        <div className="relative h-full w-full">
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
            // overflow: Ein Griff auf der Bildkante ragt um seinen Radius über
            // das Foto hinaus. Ein SVG schneidet das von sich aus ab – zu sehen
            // wäre nur die innere Hälfte. Der Rahmen um das Foto hält den Platz
            // dafür frei.
            style={{ overflow: 'visible' }}
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
              />
            ))}
          </svg>
        </div>

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
