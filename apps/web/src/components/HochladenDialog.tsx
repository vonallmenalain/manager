import { formatFileSize, titleFromFilename, type Bereich } from '@manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { AblageFelder } from './AblageFelder'
import { DocumentIcon } from './icons'
import { Modal, ModalCloseButton } from './Modal'
import type { TrayField } from './PageTray'
import { dokumentAblegen, standardAngaben, type AblageAngaben } from '../lib/ablegen'

/** Was nach dem letzten Dokument zu melden ist. */
export interface HochladenBilanz {
  hochgeladen: number
  /** Übersprungen oder mit „Abbrechen" liegen gelassen. */
  ausgelassen: number
  /** Hochgeladen, aber mit etwas, das noch fehlt – je ein Satz. */
  hinweise: string[]
}

type Stand =
  | { art: 'offen' }
  | { art: 'laeuft' }
  | { art: 'doppelt'; meldung: string }
  | { art: 'fehler'; meldung: string }

const FORMULAR = 'hochladen-formular'

/**
 * Vor dem Hochladen: ein Dokument nach dem anderen, jedes mit seinen Angaben.
 *
 * Gewählte Dateien gingen bisher ohne Zwischenschritt in die Ablage – mit dem
 * Dateinamen als Titel, unsortiert und pendent. Wer es anders wollte, musste
 * jedes Dokument danach in der Liste wiederfinden. Jetzt steht vor jeder
 * Datei, wie sie abgelegt wird: Titel, Kategorie, Zuständigkeit, Status,
 * Fälligkeit und Notiz – dieselben Felder wie nach dem Teilen. Wer nichts
 * ändern will, braucht einen Klick pro Datei.
 *
 * Jedes Dokument mit eigenen Angaben und jedes wieder mit den Vorgaben, nicht
 * eine Angabe für alle: Fünf gleichzeitig gewählte PDFs sind oft fünf
 * verschiedene Dinge – die Rechnung, die Police, der Brief der Schule.
 */
export function HochladenDialog({
  files,
  hinweise = [],
  bereich,
  felder,
  faellig,
  akzent,
  onFertig,
}: {
  /** Die gewählten Dateien, schon eingelesen (siehe `lib/einlesen.ts`). */
  files: readonly File[]
  /** Was sich beim Einlesen nicht lesen liess – steht über dem ersten Dokument. */
  hinweise?: readonly string[]
  bereich: Bereich
  /** Welche Auswahlfelder erscheinen – in der DocBase nur die Kategorie. */
  felder: readonly TrayField[]
  /** Ob „Fällig" erscheint – nur der Haushalt kennt Fälligkeiten. */
  faellig: boolean
  /** Farbe des Hochladen-Knopfes – sie gehört der App. */
  akzent: string
  onFertig: (bilanz: HochladenBilanz) => void
}) {
  const queryClient = useQueryClient()
  const [index, setIndex] = useState(0)
  const [angaben, setAngaben] = useState<AblageAngaben>(() => standardAngaben(files[0] as File))
  const [stand, setStand] = useState<Stand>({ art: 'offen' })
  const bilanz = useRef<HochladenBilanz>({ hochgeladen: 0, ausgelassen: 0, hinweise: [] })
  const titelRef = useRef<HTMLInputElement>(null)

  const file = files[index] as File
  const letzte = index === files.length - 1
  const laeuft = stand.art === 'laeuft'
  const bild = useBildAdresse(file)

  // Am Rechner steht der Cursor gleich im Titel, und der ganze Titel ist
  // markiert: Tippen ersetzt ihn, Enter lädt hoch. Auf dem Handy nicht – dort
  // schöbe die Tastatur den Knopf aus dem Bild, obwohl meist ein Tipp genügt.
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return
    titelRef.current?.focus()
    titelRef.current?.select()
  }, [index])

  function weiter() {
    if (letzte) {
      onFertig(bilanz.current)
      return
    }
    const naechste = index + 1
    setIndex(naechste)
    setAngaben(standardAngaben(files[naechste] as File))
    setStand({ art: 'offen' })
  }

  async function hochladen(trotzdem: boolean) {
    if (laeuft) return
    setStand({ art: 'laeuft' })
    const ergebnis = await dokumentAblegen(file, angaben, { bereich, felder, faellig, trotzdem })
    if (ergebnis.art !== 'abgelegt') {
      setStand({ art: ergebnis.art, meldung: ergebnis.meldung })
      return
    }
    bilanz.current.hochgeladen += 1
    if (ergebnis.hinweis) {
      bilanz.current.hinweise.push(`„${ergebnis.dokument.title}": ${ergebnis.hinweis}`)
    }
    // Die Liste dahinter zeigt jedes Dokument, sobald es angekommen ist.
    void queryClient.invalidateQueries({ queryKey: ['documents'] })
    weiter()
  }

  function ueberspringen() {
    bilanz.current.ausgelassen += 1
    weiter()
  }

  /** Aufhören – was schon hochgeladen ist, bleibt; der Rest wird nicht hochgeladen. */
  function abbrechen() {
    if (laeuft) return
    const uebrig = files.length - index
    if (uebrig > 1 && !window.confirm(`Die übrigen ${uebrig} Dateien nicht hochladen?`)) return
    bilanz.current.ausgelassen += uebrig
    onFertig(bilanz.current)
  }

  const knopf = laeuft
    ? 'Wird hochgeladen …'
    : stand.art === 'doppelt'
      ? 'Trotzdem hochladen'
      : stand.art === 'fehler'
        ? 'Nochmals versuchen'
        : letzte
          ? 'Hochladen'
          : 'Hochladen und weiter'

  return (
    <Modal
      onClose={abbrechen}
      label="Dokument hochladen"
      header={
        <>
          <p className="px-2 text-sm font-semibold">
            Dokument hochladen
            {files.length > 1 ? (
              <span className="ml-1.5 font-normal tabular-nums text-slate-500 dark:text-slate-400">
                {index + 1} von {files.length}
              </span>
            ) : null}
          </p>
          <ModalCloseButton onClick={abbrechen} label="Abbrechen" />
        </>
      }
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={files.length > 1 ? ueberspringen : abbrechen}
            disabled={laeuft}
            className="min-h-12 flex-1 rounded-xl border border-slate-300 text-base font-medium disabled:opacity-50 dark:border-slate-700"
          >
            {files.length > 1 ? 'Überspringen' : 'Abbrechen'}
          </button>
          <button
            type="submit"
            form={FORMULAR}
            disabled={laeuft}
            className={`min-h-12 flex-[2] rounded-xl text-base font-semibold text-white disabled:opacity-60 ${akzent}`}
          >
            {knopf}
          </button>
        </div>
      }
    >
      <form
        id={FORMULAR}
        onSubmit={(event) => {
          event.preventDefault()
          void hochladen(stand.art === 'doppelt')
        }}
        className="space-y-3"
      >
        {index === 0 ? hinweise.map((text) => <Hinweis key={text} text={text} />) : null}
        {stand.art === 'doppelt' || stand.art === 'fehler' ? (
          <Hinweis text={stand.meldung} />
        ) : null}

        <div className="flex items-center gap-3">
          {bild ? (
            <img
              src={bild}
              alt=""
              className="size-12 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-800"
            />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <DocumentIcon className="size-6" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium">{file.name}</span>
            <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {formatFileSize(file.size)}
            </span>
          </span>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Titel
          </span>
          <input
            ref={titelRef}
            value={angaben.titel}
            onChange={(event) => setAngaben((alt) => ({ ...alt, titel: event.target.value }))}
            disabled={laeuft}
            maxLength={200}
            autoCapitalize="sentences"
            enterKeyHint="done"
            placeholder={titleFromFilename(file.name)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <AblageFelder
          angaben={angaben}
          onChange={(changes) => setAngaben((alt) => ({ ...alt, ...changes }))}
          felder={felder}
          faellig={faellig}
          bereich={bereich}
          disabled={laeuft}
        />
      </form>
    </Modal>
  )
}

/** Ein kleines Bild der Datei, wenn sie eines ist – aus der Datei selbst, ohne Server. */
function useBildAdresse(file: File): string | null {
  const [adresse, setAdresse] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setAdresse(null)
      return
    }
    const url = URL.createObjectURL(file)
    setAdresse(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return adresse
}

function Hinweis({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {text}
    </p>
  )
}
