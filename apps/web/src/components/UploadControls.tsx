import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ApiRequestError } from '../lib/api'
import { useUploadDocument } from '../lib/documents'
import { collectSharedFiles } from '../lib/sharedFiles'

interface UploadState {
  running: number
  message: string | null
}

/**
 * Alle Wege, auf denen ein Dokument in die App kommt:
 *
 *  - Teilen aus einer anderen App (Android) – der Service Worker legt die
 *    Datei ab und leitet mit `?geteilt=n` hierher weiter
 *  - Kamera – direkt aufnehmen, ohne Umweg über die Galerie
 *  - Datei wählen – PDFs und Screenshots
 *  - App-Verknüpfung `?aufnehmen=1` – langer Druck auf das App-Symbol
 */
export function UploadControls() {
  const [searchParams, setSearchParams] = useSearchParams()
  const upload = useUploadDocument()

  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [state, setState] = useState<UploadState>({ running: 0, message: null })

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setState({ running: files.length, message: null })

      let done = 0
      const problems: string[] = []

      for (const file of files) {
        try {
          await upload.mutateAsync({ file })
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

  // Verknüpfung vom Startbildschirm: Kamera direkt öffnen.
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
    cameraRef.current?.click()
  }, [capture, setSearchParams])

  function handleInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setMenuOpen(false)
    void uploadFiles(files)
  }

  const busy = state.running > 0

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

      {/* capture='environment' öffnet auf Android direkt die Rückkamera,
          statt den Umweg über die Galerie zu nehmen. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInput}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleInput}
      />

      {menuOpen ? (
        <>
          <button
            className="fixed inset-0 z-20 bg-slate-900/20"
            onClick={() => setMenuOpen(false)}
            aria-label="Menü schliessen"
          />
          <div className="fixed bottom-40 right-4 z-30 flex flex-col items-end gap-2">
            <MenuAction label="Foto aufnehmen" onClick={() => cameraRef.current?.click()}>
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
