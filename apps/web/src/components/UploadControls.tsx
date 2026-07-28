import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DocumentScanner } from './DocumentScanner'
import { PageTray } from './PageTray'
import { ApiRequestError } from '../lib/api'
import { useUploadDocument } from '../lib/documents'
import {
  buildUpload,
  cameraAvailable,
  createPage,
  defaultScanTitle,
  pageFromFile,
  releasePage,
  type ScanPage,
} from '../lib/scan/pages'
import { collectSharedFiles } from '../lib/sharedFiles'

interface UploadState {
  running: number
  message: string | null
}

/** Woher die nächste Seite kommt, wenn im Stapel „Weitere Seite" gewählt wird. */
type PageSource = 'scanner' | 'kamera'

/**
 * Alle Wege, auf denen ein Dokument in die App kommt:
 *
 *  - Teilen aus einer anderen App (Android) – der Service Worker legt die
 *    Datei ab und leitet mit `?geteilt=n` hierher weiter
 *  - Dokument scannen – der eingebaute Scanner mit Randerkennung
 *  - Foto aufnehmen – die Kamera-App des Systems, mit allen Modi, die sie hat
 *  - Datei wählen – PDFs und Screenshots
 *  - App-Verknüpfung `?aufnehmen=1` – langer Druck auf das App-Symbol
 *
 * Aufnahmen aus den beiden Kamera-Wegen gehen nicht direkt in die Ablage,
 * sondern zuerst in einen Stapel. Erst wenn alle Seiten beisammen sind, wird
 * daraus ein Dokument – ein zweiseitiger Brief bleibt so ein Brief.
 */
export function UploadControls() {
  const [searchParams, setSearchParams] = useSearchParams()
  const upload = useUploadDocument()

  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [state, setState] = useState<UploadState>({ running: 0, message: null })

  const [pages, setPages] = useState<ScanPage[]>([])
  const [title, setTitle] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [source, setSource] = useState<PageSource>('scanner')

  const uploadFiles = useCallback(
    async (files: File[], documentTitle?: string): Promise<boolean> => {
      if (files.length === 0) return false
      setState({ running: files.length, message: null })

      let done = 0
      const problems: string[] = []

      for (const file of files) {
        try {
          await upload.mutateAsync({ file, title: documentTitle })
          done += 1
        } catch (error) {
          if (error instanceof ApiRequestError && error.code === 'duplicate') {
            problems.push(`${file.name}: liegt bereits in der Ablage`)
          } else {
            problems.push(`${file.name}: ${error instanceof Error ? error.message : 'Fehler'}`)
          }
        }
        setState((previous) => ({ ...previous, running: previous.running - 1 }))
      }

      setState({
        running: 0,
        message:
          problems.length === 0
            ? `${done} ${done === 1 ? 'Dokument' : 'Dokumente'} hinzugefügt.`
            : problems.join(' · '),
      })

      return problems.length === 0
    },
    [upload],
  )

  // Geteilte Dateien abholen. Läuft genau einmal pro Weiterleitung; der
  // Parameter wird sofort entfernt, damit ein Neuladen nicht erneut auslöst.
  const shared = searchParams.get('geteilt')
  useEffect(() => {
    if (!shared) return

    setSearchParams(
      (params) => {
        params.delete('geteilt')
        return params
      },
      { replace: true },
    )

    if (shared === 'fehler') {
      setState({ running: 0, message: 'Das geteilte Dokument konnte nicht gelesen werden.' })
      return
    }

    void collectSharedFiles().then((files) => {
      if (files.length === 0) {
        setState({
          running: 0,
          message: 'Keine geteilte Datei gefunden. Bitte nochmals teilen.',
        })
        return
      }
      void uploadFiles(files)
    })
  }, [shared, setSearchParams, uploadFiles])

  // Verknüpfung vom Startbildschirm: direkt in den Scanner.
  const capture = searchParams.get('aufnehmen')
  useEffect(() => {
    if (capture !== '1') return
    setSearchParams(
      (params) => {
        params.delete('aufnehmen')
        return params
      },
      { replace: true },
    )

    if (cameraAvailable()) {
      setSource('scanner')
      setScannerOpen(true)
    } else {
      setSource('kamera')
      cameraRef.current?.click()
    }
  }, [capture, setSearchParams])

  // Beim Verlassen der Seite bleiben sonst so viele blob:-Adressen im
  // Speicher, wie Seiten im Stapel lagen.
  const pagesRef = useRef<readonly ScanPage[]>(pages)
  pagesRef.current = pages
  useEffect(
    () => () => {
      for (const page of pagesRef.current) releasePage(page)
    },
    [],
  )

  function discardPages() {
    for (const page of pages) releasePage(page)
    setPages([])
    setTitle('')
  }

  function removePage(id: string) {
    const page = pages.find((entry) => entry.id === id)
    if (page) releasePage(page)
    setPages((current) => current.filter((entry) => entry.id !== id))
  }

  function movePage(id: string, direction: -1 | 1) {
    setPages((current) => {
      const index = current.findIndex((entry) => entry.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= current.length) return current

      const next = [...current]
      const moved = next[index] as ScanPage
      next[index] = next[target] as ScanPage
      next[target] = moved
      return next
    })
  }

  function openScanner() {
    setMenuOpen(false)
    setSource('scanner')
    setScannerOpen(true)
  }

  function openSystemCamera() {
    setMenuOpen(false)
    setSource('kamera')
    setScannerOpen(false)
    cameraRef.current?.click()
  }

  /**
   * Fotos aus der Kamera-App in den Stapel übernehmen.
   *
   * Was sich im Browser nicht öffnen lässt – auf manchen Geräten HEIC – wird
   * unverändert hochgeladen. Ins PDF könnte es nicht eingebettet werden, aber
   * als eigenes Dokument ist es allemal besser aufgehoben als in einer
   * Fehlermeldung.
   */
  async function collectPhotos(files: File[]) {
    setPreparing(true)
    const prepared: ScanPage[] = []
    const undecodable: File[] = []

    for (const file of files) {
      try {
        prepared.push(await pageFromFile(file))
      } catch {
        undecodable.push(file)
      }
    }

    if (prepared.length > 0) setPages((current) => [...current, ...prepared])
    setPreparing(false)

    if (undecodable.length > 0) await uploadFiles(undecodable)
  }

  async function uploadPages() {
    const chosen = title.trim() || defaultScanTitle()

    let file: File
    try {
      file = await buildUpload(pages, chosen)
    } catch (error) {
      setState({
        running: 0,
        message:
          error instanceof Error ? error.message : 'Die Seiten liessen sich nicht zusammenfügen.',
      })
      return
    }

    // Nur bei Erfolg verwerfen: Reisst die Verbindung ab, bleibt der Stapel
    // erhalten und ein zweiter Versuch kostet keine neue Aufnahme.
    if (await uploadFiles([file], chosen)) discardPages()
  }

  function handleCameraInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setMenuOpen(false)
    void collectPhotos(files)
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setMenuOpen(false)
    void uploadFiles(files)
  }

  const busy = state.running > 0 || preparing

  return (
    <>
      {state.message ? (
        <button
          onClick={() => setState((previous) => ({ ...previous, message: null }))}
          className="fixed inset-x-4 bottom-40 z-30 mx-auto block max-w-md rounded-xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          role="status"
        >
          {state.message}
        </button>
      ) : null}

      {/* Bewusst ohne capture-Attribut: Mit capture öffnet Android sofort die
          nackte Aufnahme-Ansicht. Ohne es erscheint die Auswahl, über die sich
          die Kamera-App mit all ihren Modi öffnen lässt – auch dem
          Dokumentenmodus, den die meisten Kameras mitbringen. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCameraInput}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleFileInput}
      />

      {scannerOpen ? (
        <DocumentScanner
          pageCount={pages.length}
          onCapture={(blob) => {
            // Die blob:-Adresse entsteht bewusst ausserhalb von setPages –
            // React ruft die Funktion darin unter Umständen zweimal auf, und
            // die zweite Adresse würde niemand mehr freigeben.
            const page = createPage(blob)
            setPages((current) => [...current, page])
          }}
          onClose={() => setScannerOpen(false)}
          onFallback={openSystemCamera}
        />
      ) : pages.length > 0 ? (
        <PageTray
          pages={pages}
          title={title}
          onTitleChange={setTitle}
          defaultTitle={defaultScanTitle()}
          busy={busy}
          onAddPage={() => (source === 'scanner' ? setScannerOpen(true) : cameraRef.current?.click())}
          onRemove={removePage}
          onMove={movePage}
          onDiscard={() => {
            if (window.confirm(`${pages.length === 1 ? 'Die Seite' : 'Alle Seiten'} verwerfen?`)) {
              discardPages()
            }
          }}
          onUpload={() => void uploadPages()}
        />
      ) : null}

      {menuOpen ? (
        <>
          <button
            className="fixed inset-0 z-20 bg-slate-900/20"
            onClick={() => setMenuOpen(false)}
            aria-label="Menü schliessen"
          />
          <div className="fixed bottom-40 right-4 z-30 flex flex-col items-end gap-2">
            <MenuAction label="Dokument scannen" onClick={openScanner}>
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
                  <path d="M4 12h16" />
                </g>
              </svg>
            </MenuAction>
            <MenuAction label="Foto aufnehmen" onClick={openSystemCamera}>
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </MenuAction>
            <MenuAction label="Datei wählen" onClick={() => fileRef.current?.click()}>
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path d="M13.5 3.5V8h4.5" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </MenuAction>
          </div>
        </>
      ) : null}

      <button
        onClick={() => setMenuOpen((open) => !open)}
        disabled={busy}
        className="fixed bottom-20 right-4 z-30 grid size-14 place-items-center rounded-full bg-brand-800 text-white shadow-lg transition active:scale-95 disabled:opacity-70"
        aria-label={busy ? 'Wird hochgeladen' : 'Dokument hinzufügen'}
        aria-expanded={menuOpen}
      >
        {busy ? (
          <svg className="size-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            className={`size-7 transition-transform ${menuOpen ? 'rotate-45' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </>
  )
}

function MenuAction({
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
      className="flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-lg dark:bg-slate-800"
    >
      {children}
      {label}
    </button>
  )
}
