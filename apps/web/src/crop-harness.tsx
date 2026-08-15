/**
 * Prüfstand für das Zuschneiden – nicht Teil der App.
 *
 * Das Fenster hat drei Eigenschaften, die sich nur in einem echten Browser
 * zeigen: Passt ein hochauflösendes Bild vollständig in die Fläche, lassen
 * sich die Griffe treffen, und sind die Knöpfe darunter erreichbar. Genau
 * daran ist die erste Fassung gescheitert – ein Bild in voller Grösse legte
 * sich über die Knöpfe, und die Griffe wurden in Anteilen statt in
 * Bildschirmpunkten gesucht.
 *
 * Das Bild entsteht hier im Canvas, damit der Prüfstand ohne Server und ohne
 * Testdatei auskommt. Über `?breite=` und `?hoehe=` lässt sich die Auflösung
 * ändern – 4000 × 3000 ist der Fall aus der Fehlermeldung.
 *
 * Speichern führt hier ins Leere: Dahinter liegt die echte Anfrage an die API,
 * und die gibt es hier nicht. Dass der Griff darauf ankommt, ist die Frage –
 * nicht, was danach passiert.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { CropDialog } from './components/CropDialog'
import './index.css'

const params = new URLSearchParams(location.search)
const BREITE = Number(params.get('breite') ?? 4000)
const HOEHE = Number(params.get('hoehe') ?? 3000)

/** Ein Bild mit erkennbaren Ecken – damit man sieht, was abgeschnitten wird. */
function testbild(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Kein 2D-Kontext')

  const verlauf = context.createLinearGradient(0, 0, width, height)
  verlauf.addColorStop(0, '#dbeafe')
  verlauf.addColorStop(1, '#fde68a')
  context.fillStyle = verlauf
  context.fillRect(0, 0, width, height)

  context.strokeStyle = '#1e293b'
  context.lineWidth = Math.max(2, width / 200)
  context.strokeRect(0, 0, width, height)

  context.fillStyle = '#1e293b'
  context.font = `${Math.round(height / 12)}px sans-serif`
  context.textBaseline = 'top'
  context.fillText('OBEN LINKS', width / 40, height / 40)
  context.textBaseline = 'bottom'
  context.fillText('UNTEN LINKS', width / 40, height - height / 40)
  context.textAlign = 'right'
  context.fillText('UNTEN RECHTS', width - width / 40, height - height / 40)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Kein Bild'))),
      'image/jpeg',
      0.9,
    )
  })
}

function Harness() {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let adresse: string | null = null
    void testbild(BREITE, HOEHE).then((blob) => {
      adresse = URL.createObjectURL(blob)
      setUrl(adresse)
    })
    return () => {
      if (adresse) URL.revokeObjectURL(adresse)
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col p-4">
      <p className="text-sm">
        Prüfstand Zuschneiden – Bild {BREITE} × {HOEHE}
      </p>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 self-start rounded-xl bg-brand-800 px-4 py-2 text-white"
      >
        Zuschneiden öffnen
      </button>

      {open && url ? (
        <CropDialog
          documentId="pruefstand"
          title="Prüfbild"
          mimeType="image/jpeg"
          pages={1}
          sourceUrl={url}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')

// Die Wurzel wird gemerkt, statt bei jedem Durchlauf des Moduls eine neue
// anzulegen: Vite schiebt beim Entwickeln geänderte Module nach, und eine
// zweite Wurzel auf demselben Element zeichnete das Fenster ein zweites Mal –
// zwei übereinanderliegende Fenster, von denen man nur eines sieht.
const gemerkt = window as typeof window & { __cropWurzel?: ReturnType<typeof createRoot> }
gemerkt.__cropWurzel ??= createRoot(container)
gemerkt.__cropWurzel.render(
  <QueryClientProvider client={new QueryClient()}>
    <Harness />
  </QueryClientProvider>,
)
