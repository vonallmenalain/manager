/**
 * Prüfstand für den Scanner – nicht Teil der App.
 *
 * Baut die Hülle der App nach (Kopfzeile, Inhalt, Navigationsleiste) und
 * öffnet darin den Scanner, damit sich Überlagerung und Kamerabild in einem
 * echten Browser anschauen lassen. Mit ?portal=0 wird die Fläche wie früher
 * als Kind des Inhalts gezeichnet – zum Vergleich.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { DocumentScanner } from './components/DocumentScanner'
import { PageTray } from './components/PageTray'
import {
  createPage,
  defaultScanTitle,
  releasePage,
  rotatePage,
  type ScanPage,
} from './lib/scan/pages'
import './index.css'

const usePortal = new URLSearchParams(location.search).get('portal') !== '0'

function Harness() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(true)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <span className="grid size-9 place-items-center rounded-full bg-brand-800 text-sm font-bold text-white">
            A
          </span>
          <p className="text-sm font-semibold">Prüfstand</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">
        <p className="text-sm">Inhalt der Seite</p>
        <button onClick={() => setOpen(true)} className="mt-4 rounded-xl bg-brand-800 px-4 py-2 text-white">
          Scanner öffnen
        </button>

        {open ? (
          usePortal ? (
            <DocumentScanner
              pageCount={pages.length}
              onCapture={(blob) => {
                const page = createPage(blob)
                setPages((current) => [...current, page])
              }}
              onClose={() => setOpen(false)}
              onFallback={() => setOpen(false)}
            />
          ) : (
            <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
              <p className="p-4 text-sm">Fläche ohne Portal – deckt sie die Leiste unten zu?</p>
            </div>
          )
        ) : pages.length > 0 ? (
          <PageTray
            pages={pages}
            title={title}
            onTitleChange={setTitle}
            defaultTitle={defaultScanTitle()}
            busy={false}
            onAddPage={() => setOpen(true)}
            onRemove={(id) => {
              const page = pages.find((entry) => entry.id === id)
              if (page) releasePage(page)
              setPages((current) => current.filter((entry) => entry.id !== id))
            }}
            onMove={() => undefined}
            onRotate={(id) => {
              const page = pages.find((entry) => entry.id === id)
              if (!page) return
              void rotatePage(page).then((gedreht) => {
                setPages((current) =>
                  current.map((entry) => (entry.id === id ? gedreht : entry)),
                )
                releasePage(page)
              })
            }}
            onDiscard={() => setPages([])}
            onUpload={() => undefined}
          />
        ) : null}
      </main>

      <nav
        data-navigationsleiste
        className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          {['Start', 'Dokumente', 'Einkauf', 'Notizen', 'Finanzen'].map((label) => (
            <li key={label} className="flex-1">
              <span className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
                <span className="size-6 rounded bg-slate-300" />
                {label}
              </span>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Wurzelelement #root nicht gefunden')
createRoot(container).render(<Harness />)
