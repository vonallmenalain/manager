import {
  blocksFromText,
  docOfValue,
  formatFileSize,
  toRichValue,
  withWritingLines,
  type Bereich,
  type Note,
  type RichBlock,
} from '@manager/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { DocumentIcon, FolderIcon, NoteIcon } from '../components/icons'
import { EinfuegeWahl, FortschrittText } from '../components/NoteFiles'
import { formatEdited } from '../components/NoteParts'
import { useNotes, useSaveNote } from '../lib/household'
import {
  dateienAlsBloecke,
  inNotizEinsetzen,
  titelAusDateiname,
  type EinfuegeArt,
  type Fortschritt,
} from '../lib/noteFiles'
import { DOCBASE_SHARE_CACHE, SHARE_CACHE } from '../lib/shareConstants'
import {
  discardSharedContent,
  istLeer,
  readSharedContent,
  type SharedContent,
} from '../lib/sharedContent'
import { hatText, noteFromShare } from '../lib/shareNote'

/**
 * Wohin mit dem Geteilten?
 *
 * Diese Seite steht am Ende des Android-Teilen-Menüs: Der Service Worker legt
 * ab, was ankommt, und leitet hierher. Manager und DocBase haben je ihre
 * eigene – wer an die DocBase teilt, landet in der DocBase und kann nur dort
 * ablegen, und umgekehrt.
 *
 * Zwei Ziele, die immer beide dastehen:
 *
 *  - die Ablage (Dokumente im Manager, die Sammlung in der DocBase) – nur für
 *    Dateien, mit Texterkennung und Suche wie jedes hochgeladene Dokument;
 *  - eine Notiz, neu oder schon vorhanden. Dorthin passt alles: Text und
 *    Verweise als Text, Dateien entweder ganz (sie stehen in der Notiz und
 *    öffnen sich per Tipp) oder als ihr erkannter Text.
 *
 * Ein nicht mögliches Ziel verschwindet nicht, sondern wird blass und trägt
 * den Grund als Beschreibung – wer teilt, soll einmal lesen, was diese App mit
 * was macht, und es danach wissen.
 */

export type ShareApp = 'manager' | 'docbase'

interface AppSicht {
  name: string
  bereich: Bereich
  cache: string
  ablage: string
  ablageText: (dateien: number) => string
  /** Wohin „Dokumente" bzw. „Sammlung" führt – dort holt der Upload die Dateien ab. */
  ablageZiel: (dateien: number) => string
  akzent: 'brand' | 'teal'
  knopf: string
}

const SICHTEN: Record<ShareApp, AppSicht> = {
  manager: {
    name: 'Manager',
    bereich: 'manager',
    cache: SHARE_CACHE,
    ablage: 'Dokumente',
    ablageText: (dateien) =>
      `${dateien === 1 ? 'Die Datei' : `Alle ${dateien} Dateien`} in die Ablage – mit Texterkennung und Suche.`,
    ablageZiel: (dateien) => `/dokumente?geteilt=${dateien}`,
    akzent: 'brand',
    knopf: 'bg-brand-800 text-white',
  },
  docbase: {
    name: 'DocBase',
    bereich: 'docbase',
    cache: DOCBASE_SHARE_CACHE,
    ablage: 'Sammlung',
    ablageText: (dateien) =>
      `${dateien === 1 ? 'Die Datei' : `Alle ${dateien} Dateien`} in die Sammlung – mit Texterkennung und Suche.`,
    ablageZiel: (dateien) => `/?geteilt=${dateien}`,
    akzent: 'teal',
    knopf: 'bg-teal-700 text-white',
  },
}

/** Was gerade geschieht: Dateien hochladen oder lesen – oder die Notiz speichern. */
type Arbeit = Fortschritt | 'speichert'

export function Share({ app }: { app: ShareApp }) {
  const sicht = SICHTEN[app]
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const save = useSaveNote()

  // null, solange gelesen wird: Ein „nichts angekommen" im selben Moment, in
  // dem der Zwischenspeicher noch antwortet, wäre eine Falschmeldung.
  const [content, setContent] = useState<SharedContent | null>(null)
  const [fehler, setFehler] = useState<string | null>(
    params.get('fehler')
      ? 'Das Geteilte konnte nicht gelesen werden. Bitte nochmals teilen.'
      : null,
  )
  const [schritt, setSchritt] = useState<'ziel' | 'notiz'>('ziel')
  const [art, setArt] = useState<EinfuegeArt>('datei')
  const [arbeit, setArbeit] = useState<Arbeit | null>(null)
  const abbruch = useRef<AbortController | null>(null)

  useEffect(() => {
    void readSharedContent(sicht.cache).then(setContent)
  }, [sicht.cache])

  // Wer auf der Seite abbricht oder sie verlässt, hält auch das Hochladen an.
  useEffect(() => () => abbruch.current?.abort(), [])

  /**
   * In eine Notiz – eine neue (`ziel` null) oder ans Ende einer bestehenden.
   *
   * Erst wenn die Notiz gespeichert ist, wird der Zwischenspeicher geleert:
   * Scheitert unterwegs etwas, lässt sich dasselbe Geteilte gleich nochmals
   * verwenden, statt in der anderen App erneut teilen zu müssen.
   */
  async function inNotiz(shared: SharedContent, ziel: Note | null) {
    const controller = new AbortController()
    abbruch.current = controller
    setFehler(null)

    try {
      const { title, body } = noteFromShare(shared)
      const bloecke: RichBlock[] = body ? blocksFromText(body) : []

      if (shared.files.length > 0) {
        setArbeit({ art, schritt: 1, von: shared.files.length })
        bloecke.push(
          ...(await dateienAlsBloecke(shared.files, art, sicht.bereich, {
            signal: controller.signal,
            onFortschritt: setArbeit,
          })),
        )
      }

      setArbeit('speichert')
      const bestehend = ziel
        ? withWritingLines(docOfValue({ text: ziel.body, rich: ziel.bodyRich }))
        : null
      const { doc } = inNotizEinsetzen(bestehend, null, bloecke)
      const value = toRichValue(doc)

      const { note } = await save.mutateAsync(
        ziel
          ? {
              id: ziel.id,
              note: {
                title: ziel.title,
                body: value.text,
                bodyRich: value.rich,
                kind: ziel.kind,
                bereich: ziel.bereich,
                categoryId: ziel.categoryId,
                pinned: ziel.pinned,
                shared: ziel.shared,
                color: ziel.color,
              },
            }
          : {
              note: {
                title: title || titelAusDateiname(shared.files[0]?.name ?? ''),
                body: value.text,
                bodyRich: value.rich,
                kind: 'text',
                bereich: sicht.bereich,
                categoryId: null,
                pinned: false,
                // Im Haushalt zunächst privat, wie jede neue Notiz; in der
                // DocBase gehört ohnehin alles allen.
                shared: sicht.bereich === 'docbase',
                color: 'default',
              },
            },
      )

      await discardSharedContent(sicht.cache)
      // Die Notiz geht gleich auf: Wer noch etwas dazuschreiben will, ist
      // schon dort – wer nicht, hat sie sicher.
      if (app === 'docbase') navigate('/', { replace: true, state: { notiz: note } })
      else navigate(`/notizen?notiz=${note.id}`, { replace: true })
    } catch (error) {
      if (controller.signal.aborted) return
      setFehler(
        error instanceof Error
          ? `Das hat nicht geklappt: ${error.message}`
          : 'Das hat nicht geklappt. Bitte nochmals versuchen.',
      )
    } finally {
      if (abbruch.current === controller) abbruch.current = null
      setArbeit(null)
    }
  }

  function inDieAblage(shared: SharedContent) {
    // Das Hochladen selbst macht die Ablage – dort steht ohnehin alles, was
    // ein Upload braucht, samt Fortschritt und Fehlermeldung. `replace`, damit
    // der Zurück-Knopf nicht auf diese Seite führt, deren Inhalt dann bereits
    // verbraucht ist.
    navigate(sicht.ablageZiel(shared.files.length), { replace: true })
  }

  async function verwerfen() {
    await discardSharedContent(sicht.cache)
    navigate('/', { replace: true })
  }

  const kopf = <h1 className="text-2xl font-bold">Geteilt an {sicht.name}</h1>

  if (!content) {
    return (
      <div className="space-y-4">
        {kopf}
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      </div>
    )
  }

  if (istLeer(content)) {
    return (
      <div className="space-y-4">
        {kopf}
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

  if (arbeit) {
    return (
      <div className="space-y-4">
        {kopf}
        <div
          role="status"
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900"
        >
          <FortschrittText fortschritt={arbeit} />
        </div>
        <button
          onClick={() => abbruch.current?.abort()}
          className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          Abbrechen
        </button>
      </div>
    )
  }

  if (schritt === 'notiz') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSchritt('ziel')}
            aria-label="Zurück zur Auswahl"
            className="-ml-2 grid size-11 place-items-center rounded-full text-2xl text-slate-500 dark:text-slate-400"
          >
            ‹
          </button>
          <h1 className="text-2xl font-bold">In eine Notiz</h1>
        </div>

        {fehler ? <Hinweis text={fehler} /> : null}

        {dateien > 0 ? (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Wie einfügen?
            </p>
            <EinfuegeWahl gewaehlt={art} onWahl={setArt} akzent={sicht.akzent} />
          </section>
        ) : null}

        <NotizWahl
          bereich={sicht.bereich}
          knopf={sicht.knopf}
          onNeu={() => void inNotiz(content, null)}
          onBestehend={(note) => void inNotiz(content, note)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {kopf}

      {fehler ? <Hinweis text={fehler} /> : null}

      <Vorschau content={content} />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Wohin damit?</p>

        <Ziel
          titel={sicht.ablage}
          beschreibung={
            dateien > 0
              ? sicht.ablageText(dateien)
              : 'Nur für Dateien: PDF, Foto oder Bildschirmfoto.'
          }
          moeglich={dateien > 0}
          onClick={() => inDieAblage(content)}
          icon={
            app === 'docbase' ? (
              <FolderIcon className="size-6" />
            ) : (
              <DocumentIcon className="size-6" />
            )
          }
          akzent={sicht.akzent}
        />

        <Ziel
          titel="Notiz"
          beschreibung={
            dateien > 0
              ? 'In eine neue oder bestehende Notiz – als ganze Datei oder nur ihr Text.'
              : 'In eine neue oder bestehende Notiz – ein Verweis bleibt anklickbar.'
          }
          moeglich={dateien > 0 || text}
          onClick={() => setSchritt('notiz')}
          icon={<NoteIcon className="size-6" />}
          akzent={sicht.akzent}
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

/**
 * Neue Notiz oder eine bestehende – mit Suche, weil „die Notiz mit den
 * Rezepten" nach fünfzig Notizen nicht mehr oben steht.
 *
 * Nur Notizen mit Fliesstext: Eine Checkliste besteht aus Einträgen zum
 * Abhaken, in die weder ein Bild noch ein Absatz passt.
 */
function NotizWahl({
  bereich,
  knopf,
  onNeu,
  onBestehend,
}: {
  bereich: Bereich
  knopf: string
  onNeu: () => void
  onBestehend: (note: Note) => void
}) {
  const [suche, setSuche] = useState('')
  const query = useNotes({ bereich, q: suche.trim() || undefined })
  const notizen = useMemo(
    () => (query.data?.notes ?? []).filter((note) => note.kind === 'text').slice(0, 30),
    [query.data],
  )

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        In welche Notiz?
      </p>

      <button
        onClick={onNeu}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-medium shadow-sm transition active:scale-[0.99] ${knopf}`}
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        Neue Notiz
      </button>

      <p className="pt-2 text-sm text-slate-500 dark:text-slate-400">
        Oder ans Ende einer bestehenden:
      </p>
      <input
        type="search"
        value={suche}
        onChange={(event) => setSuche(event.target.value)}
        placeholder="Notiz suchen…"
        aria-label="Notiz suchen"
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none dark:border-slate-700 dark:bg-slate-900"
      />

      {query.isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ) : notizen.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {suche ? 'Keine passende Notiz.' : 'Noch keine Notizen.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {notizen.map((note) => (
            <li key={note.id}>
              <button
                onClick={() => onBestehend(note)}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition active:bg-slate-50 dark:active:bg-slate-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {note.title || note.body.split('\n')[0] || 'Ohne Titel'}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {formatEdited(note.updatedAt)}
                  </span>
                </span>
                {note.pinned ? <span title="Angeheftet">📌</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Was angekommen ist – damit man vor der Wahl sieht, worüber man entscheidet. */
function Vorschau({ content }: { content: SharedContent }) {
  const { title, body } = noteFromShare(content)
  const bilder = useBildAdressen(content.files)

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
              {bilder[index] ? (
                <img
                  src={bilder[index]}
                  alt=""
                  className="size-10 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-800"
                />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <DocumentIcon className="size-5" />
                </span>
              )}
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

/** Kleine Bilder der geteilten Fotos – aus den Dateien selbst, ohne Umweg über den Server. */
function useBildAdressen(files: readonly File[]): (string | null)[] {
  const [adressen, setAdressen] = useState<(string | null)[]>([])
  useEffect(() => {
    const neu = files.map((file) =>
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    )
    setAdressen(neu)
    return () => {
      for (const adresse of neu) if (adresse) URL.revokeObjectURL(adresse)
    }
  }, [files])
  return adressen
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
  onClick,
  icon,
  akzent,
}: {
  titel: string
  beschreibung: string
  moeglich: boolean
  onClick: () => void
  icon: React.ReactNode
  akzent: 'brand' | 'teal'
}) {
  return (
    <button
      onClick={onClick}
      disabled={!moeglich}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900"
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl ${
          akzent === 'teal'
            ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200'
            : 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
        }`}
      >
        {icon}
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
