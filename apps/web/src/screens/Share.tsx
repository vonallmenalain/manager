import { formatFileSize } from '@manager/shared'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { DocumentIcon, NoteIcon } from '../components/icons'
import { useSaveNote } from '../lib/household'
import { hatText, noteFromShare } from '../lib/shareNote'
import {
  discardSharedContent,
  istLeer,
  readSharedContent,
  type SharedContent,
} from '../lib/sharedContent'

/**
 * Wohin mit dem Geteilten?
 *
 * Diese Seite steht am Ende des Android-Teilen-Menüs: Der Service Worker legt
 * ab, was ankommt, und leitet hierher. Vorher führte der Weg geradewegs in die
 * Dokumente – gut für ein PDF aus der Mail, unbrauchbar für einen Verweis, der
 * dort wortlos verschwand, weil keine Datei dabei war.
 *
 * Entschieden wird nach dem, was tatsächlich angekommen ist: Dateien gehören
 * in die Ablage, Text und Verweise in eine Notiz. Beides steht trotzdem immer
 * beisammen, das nicht mögliche Ziel mit dem Grund daneben – wer teilt, soll
 * einmal lesen, was diese App mit was macht, und es danach wissen.
 */
export function Share() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const save = useSaveNote()

  // null, solange gelesen wird: Ein „nichts angekommen" im selben Moment, in
  // dem der Zwischenspeicher noch antwortet, wäre eine Falschmeldung.
  const [content, setContent] = useState<SharedContent | null>(null)
  const [fehler, setFehler] = useState<string | null>(
    params.get('fehler') ? 'Das Geteilte konnte nicht gelesen werden. Bitte nochmals teilen.' : null,
  )

  useEffect(() => {
    void readSharedContent().then(setContent)
  }, [])

  async function alsNotiz(shared: SharedContent) {
    setFehler(null)
    try {
      const { note } = await save.mutateAsync({
        note: {
          ...noteFromShare(shared),
          kind: 'text',
          pinned: false,
          shared: false,
          color: 'default',
        },
      })
      await discardSharedContent()
      // Die Notiz ist gespeichert und geht gleich auf: Wer noch etwas
      // dazuschreiben will, ist schon dort – wer nicht, hat sie sicher.
      navigate(`/notizen?notiz=${note.id}`, { replace: true })
    } catch (error) {
      setFehler(
        error instanceof Error
          ? `Die Notiz konnte nicht gespeichert werden: ${error.message}`
          : 'Die Notiz konnte nicht gespeichert werden.',
      )
    }
  }

  function inDieDokumente(shared: SharedContent) {
    // Das Hochladen selbst macht die Dokumentenseite – dort steht ohnehin
    // alles, was ein Upload braucht, samt Fortschritt und Fehlermeldung.
    // `replace`, damit der Zurück-Knopf nicht auf diese Seite führt, deren
    // Inhalt dann bereits verbraucht ist.
    navigate(`/dokumente?geteilt=${shared.files.length}`, { replace: true })
  }

  async function verwerfen() {
    await discardSharedContent()
    navigate('/', { replace: true })
  }

  if (!content) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Geteilt an Manager</h1>
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      </div>
    )
  }

  if (istLeer(content)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Geteilt an Manager</h1>
        {fehler ? <Hinweis text={fehler} /> : null}
        <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <p className="font-medium">Nichts angekommen</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bitte in der anderen App nochmals auf Teilen tippen.
          </p>
        </div>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          Zur Startseite
        </button>
      </div>
    )
  }

  const dateien = content.files.length
  const text = hatText(content)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Geteilt an Manager</h1>

      {fehler ? <Hinweis text={fehler} /> : null}

      <Vorschau content={content} />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ablegen in</p>

        <Ziel
          titel="Dokumente"
          beschreibung={
            dateien > 0
              ? `${dateien === 1 ? 'Die Datei' : `Alle ${dateien} Dateien`} in die Ablage – mit Texterkennung und Suche.`
              : 'Nur für Dateien: PDF, Foto oder Bildschirmfoto.'
          }
          moeglich={dateien > 0}
          onClick={() => inDieDokumente(content)}
          icon={<DocumentIcon className="size-6" />}
        />

        <Ziel
          titel="Notizen"
          beschreibung={
            text
              ? 'Als neue Notiz – der Verweis bleibt anklickbar.'
              : 'Nur für Text und Verweise; eine Datei lässt sich nicht in eine Notiz legen.'
          }
          moeglich={text}
          busy={save.isPending}
          onClick={() => void alsNotiz(content)}
          icon={<NoteIcon className="size-6" />}
        />
      </div>

      <button
        onClick={() => void verwerfen()}
        className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
      >
        Verwerfen
      </button>
    </div>
  )
}

/** Was angekommen ist – damit man vor der Wahl sieht, worüber man entscheidet. */
function Vorschau({ content }: { content: SharedContent }) {
  const { title, body } = noteFromShare(content)

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {title ? <p className="font-medium">{title}</p> : null}

      {body ? (
        // break-all wäre zu viel, break-words zu wenig: Eine lange Adresse ohne
        // Leerzeichen muss umbrechen dürfen, ein Satz soll es an den Wörtern.
        <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">
          {body}
        </p>
      ) : null}

      {content.files.length > 0 ? (
        <ul className="space-y-2">
          {content.files.map((file, index) => (
            <li key={index} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <DocumentIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{file.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {formatFileSize(file.size)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Ein Ziel zur Auswahl.
 *
 * Ein nicht mögliches Ziel verschwindet nicht, sondern wird blass und trägt
 * den Grund als Beschreibung. Ein Menü, das je nach Inhalt anders aussieht,
 * lässt einen jedes Mal neu suchen – und die Frage „warum kann ich das jetzt
 * nicht" stellt sich ohnehin, ob die Zeile da ist oder nicht.
 */
function Ziel({
  titel,
  beschreibung,
  moeglich,
  busy = false,
  onClick,
  icon,
}: {
  titel: string
  beschreibung: string
  moeglich: boolean
  busy?: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={!moeglich || busy}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
        {busy ? (
          <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          icon
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{titel}</span>
        <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
          {beschreibung}
        </span>
      </span>
      {moeglich ? (
        <svg
          className="size-5 shrink-0 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
    </button>
  )
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
