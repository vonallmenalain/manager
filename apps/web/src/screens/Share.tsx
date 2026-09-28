import {
  blocksFromText,
  DEFAULT_DOCUMENT_STATUS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  docOfValue,
  formatFileSize,
  titleFromFilename,
  toRichValue,
  UNASSIGNED_LABEL,
  withWritingLines,
  type Bereich,
  type DocumentStatus,
  type ManagedDocument,
  type Note,
  type RichBlock,
} from '@manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CategorySelect } from '../components/CategoryPicker'
import { DocumentIcon, FolderIcon, NoteIcon } from '../components/icons'
import { EinfuegeWahl, FortschrittText } from '../components/NoteFiles'
import { formatEdited } from '../components/NoteParts'
import { ALLE_TRAY_FELDER, TraySelect, type TrayField } from '../components/PageTray'
import { api, ApiRequestError } from '../lib/api'
import { useCategories, useHouseholdUsers, useUploadDocument } from '../lib/documents'
import { useNotes, useSaveNote } from '../lib/household'
import {
  dateienAlsBloecke,
  inNotizEinsetzen,
  titelAusDateiname,
  type EinfuegeArt,
  type Fortschritt,
} from '../lib/noteFiles'
import { DOCBASE_SHARE_CACHE, SHARE_CACHE, type ShareProtokoll } from '../lib/shareConstants'
import {
  contentFromFiles,
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
 *    Dateien, mit Texterkennung und Suche wie jedes hochgeladene Dokument.
 *    Vorher stehen die Angaben zum Anpassen da – Titel, Kategorie, wer
 *    zuständig ist, ob es pendent ist –, damit das Dokument nicht als
 *    „Unsortiert" in der Liste liegt, bis man es wiederfindet;
 *  - eine Notiz, neu oder schon vorhanden. Dorthin passt alles: Text und
 *    Verweise als Text, Dateien entweder ganz (sie stehen in der Notiz und
 *    öffnen sich per Tipp) oder als ihr erkannter Text.
 *
 * Ein nicht mögliches Ziel verschwindet nicht, sondern wird blass und trägt
 * den Grund als Beschreibung – wer teilt, soll einmal lesen, was diese App mit
 * was macht, und es danach wissen.
 *
 * Kommt nichts an – manche Apps geben beim Teilen keine Datei mit –, sagt die
 * Seite, was der Worker tatsächlich bekommen hat, und bietet an, die Datei
 * gleich hier auszuwählen. Danach geht es genau gleich weiter.
 */

export type ShareApp = 'manager' | 'docbase'

interface AppSicht {
  name: string
  bereich: Bereich
  cache: string
  ablage: string
  ablageText: (dateien: number) => string
  /** Welche Angaben vor dem Ablegen gewählt werden – wie im Stapel des Scanners. */
  felder: readonly TrayField[]
  /** Ob „Fällig" dabei ist – nur der Haushalt kennt Fälligkeiten. */
  faellig: boolean
  /** Wo es nach dem Ablegen weitergeht: beim Dokument, oder bei mehreren in der Liste. */
  dokumentZiel: (id?: string) => string
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
      `${dateien === 1 ? 'Die Datei' : `Alle ${dateien} Dateien`} in die Ablage – vorher Titel, Kategorie und Status anpassen.`,
    felder: ALLE_TRAY_FELDER,
    faellig: true,
    dokumentZiel: (id) => (id ? `/dokumente/${id}` : '/dokumente'),
    akzent: 'brand',
    knopf: 'bg-brand-800 text-white',
  },
  docbase: {
    name: 'DocBase',
    bereich: 'docbase',
    cache: DOCBASE_SHARE_CACHE,
    ablage: 'Sammlung',
    ablageText: (dateien) =>
      `${dateien === 1 ? 'Die Datei' : `Alle ${dateien} Dateien`} in die Sammlung – vorher Titel und Kategorie anpassen.`,
    felder: ['kategorie'],
    faellig: false,
    dokumentZiel: (id) => (id ? `/${id}` : '/'),
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
  const [schritt, setSchritt] = useState<'ziel' | 'notiz' | 'ablage'>('ziel')
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

  /**
   * Abgelegt: Zwischenspeicher leeren und dorthin, wo das Dokument steht –
   * beim einzelnen gleich in seine Ansicht, bei mehreren in die Liste.
   * `replace`, damit der Zurück-Knopf nicht auf diese Seite führt, deren
   * Inhalt dann bereits verbraucht ist.
   */
  async function abgelegt(dokumente: ManagedDocument[]) {
    await discardSharedContent(sicht.cache)
    navigate(sicht.dokumentZiel(dokumente.length === 1 ? dokumente[0]?.id : undefined), {
      replace: true,
    })
  }

  /** Die Datei selbst wählen, wenn beim Teilen keine ankam. */
  function dateienGewaehlt(files: File[]) {
    if (files.length === 0) return
    setFehler(null)
    setContent(contentFromFiles(files))
    setSchritt('ziel')
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
        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center dark:border-slate-700">
          <p className="font-medium">Keine Datei angekommen</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {leerGrund(content.protokoll)} Die Datei lässt sich hier direkt auswählen – im
            Auswahlfenster stehen auch Google Drive und die Downloads.
          </p>
          <DateiWahl knopf={sicht.knopf} onDateien={dateienGewaehlt} />
        </div>
        <ProtokollAnzeige protokoll={content.protokoll} />
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

  if (schritt === 'ablage') {
    return (
      <AblageFormular
        files={content.files}
        sicht={sicht}
        onZurueck={() => setSchritt('ziel')}
        onAbgelegt={(dokumente) => void abgelegt(dokumente)}
      />
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
      {leereDateien(content.protokoll).length > 0 ? (
        <Hinweis
          text={`${leereDateien(content.protokoll).join(', ')} kam leer an und fehlt deshalb – die Datei lässt sich unten selbst auswählen.`}
        />
      ) : null}

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
          onClick={() => setSchritt('ablage')}
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

      {dateien === 0 || leereDateien(content.protokoll).length > 0 ? (
        <DateiWahl knopf={sicht.knopf} onDateien={dateienGewaehlt} dezent />
      ) : null}

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
 * Die Datei selbst wählen – für den Fall, dass die andere App beim Teilen
 * keine mitgab. Über die Auswahl des Systems: Dort stehen neben den Downloads
 * auch Google Drive und andere Ablagen.
 */
function DateiWahl({
  knopf,
  onDateien,
  dezent = false,
}: {
  knopf: string
  onDateien: (files: File[]) => void
  /** Als Textknopf statt als auffälliger – wenn schon etwas angekommen ist. */
  dezent?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={
          dezent
            ? 'min-h-11 w-full rounded-xl border border-slate-300 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200'
            : `min-h-12 w-full rounded-2xl px-4 text-base font-medium shadow-sm transition active:scale-[0.99] ${knopf}`
        }
      >
        Datei auswählen
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          onDateien(files)
        }}
      />
    </>
  )
}

/** Die Dateien, die leer ankamen – die andere App gab ihren Inhalt nicht mit. */
function leereDateien(protokoll: ShareProtokoll | null | undefined): string[] {
  return (protokoll?.felder ?? [])
    .filter((feld) => feld.art === 'datei' && feld.laenge === 0 && feld.datei)
    .map((feld) => `„${feld.datei}"`)
}

/** Warum nichts ankam – so genau, wie es das Protokoll des Workers sagt. */
function leerGrund(protokoll: ShareProtokoll | null | undefined): string {
  if (!protokoll) return 'Hier liegt nichts, das sich ablegen liesse.'
  const leer = leereDateien(protokoll)
  if (leer.length > 0) {
    return `${leer.join(', ')} kam leer an – die andere App hat den Inhalt nicht mitgegeben.`
  }
  return 'Die andere App hat beim Teilen keine Datei mitgegeben.'
}

/**
 * Was der Worker beim Teilen bekommen hat – eingeklappt, für den Fall, dass
 * man der Sache nachgehen will. Nur Namen, Arten und Grössen.
 */
function ProtokollAnzeige({ protokoll }: { protokoll: ShareProtokoll | null | undefined }) {
  if (!protokoll) return null
  return (
    <details className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
      <summary className="cursor-pointer py-1 text-slate-500 dark:text-slate-400">
        Was ist angekommen?
      </summary>
      {protokoll.felder.length === 0 ? (
        <p className="py-1">Gar nichts – auch kein Text.</p>
      ) : (
        <ul className="space-y-0.5 py-1">
          {protokoll.felder.map((feld, index) => (
            <li key={index} className="break-words">
              <span className="font-mono text-xs">{feld.name}</span>:{' '}
              {feld.art === 'datei'
                ? `Datei „${feld.datei || 'ohne Namen'}" · ${feld.typ || 'ohne Typ'} · ${formatFileSize(feld.laenge)}`
                : feld.laenge === 0
                  ? 'leer'
                  : `Text, ${feld.laenge} Zeichen`}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/** Die Angaben vor dem Ablegen – für alle Dateien dieselben, nur der Titel je Datei. */
interface Angaben {
  titel: string[]
  categoryId: string | null
  assignedTo: string | null
  status: DocumentStatus
  /** JJJJ-MM-TT oder leer */
  faellig: string
  notiz: string
}

/** Wie es um eine Datei steht – ein zweiter Versuch lädt nichts doppelt hoch. */
type DateiStand =
  | { art: 'offen' }
  | { art: 'abgelegt'; dokument: ManagedDocument }
  | { art: 'doppelt'; meldung: string; vorhanden?: ManagedDocument }
  | { art: 'fehler'; meldung: string }

/**
 * Vor dem Ablegen: Titel, Kategorie, Zuständigkeit, Status – dazu Fälligkeit
 * und Notiz.
 *
 * Dieselben Angaben wie im Stapel des Scanners und mit denselben Feldern,
 * damit sich Ablegen überall gleich anfühlt. Wer in diesem Moment weiss, dass
 * die Rechnung pendent ist und wen sie angeht, soll es jetzt sagen können –
 * nicht erst, nachdem er das Dokument in der Liste wiedergefunden hat. Was
 * darüber hinausgeht (Datum, Betrag, Absender), steht danach in der Ansicht
 * des Dokuments, die gleich aufgeht.
 *
 * Mehrere Dateien werden mehrere Dokumente, jedes mit eigenem Titel; die
 * übrigen Angaben gelten für alle. Liegt eine Datei schon in der Ablage, sagt
 * das die Seite – und lässt sie trotzdem ablegen oder das vorhandene Dokument
 * öffnen.
 */
function AblageFormular({
  files,
  sicht,
  onZurueck,
  onAbgelegt,
}: {
  files: readonly File[]
  sicht: AppSicht
  onZurueck: () => void
  onAbgelegt: (dokumente: ManagedDocument[]) => void
}) {
  const categories = useCategories(sicht.bereich)
  const users = useHouseholdUsers()
  const upload = useUploadDocument()
  const queryClient = useQueryClient()

  const [angaben, setAngaben] = useState<Angaben>(() => ({
    titel: files.map((file) => titleFromFilename(file.name)),
    categoryId: null,
    assignedTo: null,
    status: DEFAULT_DOCUMENT_STATUS,
    faellig: '',
    notiz: '',
  }))
  const [staende, setStaende] = useState<DateiStand[]>(() => files.map(() => ({ art: 'offen' })))
  const [laeuft, setLaeuft] = useState<{ schritt: number; von: number } | null>(null)

  const busy = laeuft !== null
  const felder = sicht.felder
  const andere = (changes: Partial<Angaben>) => setAngaben((alt) => ({ ...alt, ...changes }))

  const abgelegte = staende.flatMap((stand) => (stand.art === 'abgelegt' ? [stand.dokument] : []))
  const doppelte = staende.filter((stand) => stand.art === 'doppelt')
  const nochOffen = staende.filter((stand) => stand.art === 'offen' || stand.art === 'fehler')
  const meldungen = staende.flatMap((stand, index) =>
    stand.art === 'doppelt' || stand.art === 'fehler'
      ? [`${files[index]?.name ?? 'Datei'}: ${stand.meldung}`]
      : [],
  )
  // Nur eine Datei, und die liegt schon in der Ablage: Dann ist „öffnen" oft
  // genau das, was man wollte.
  const vorhanden =
    files.length === 1 && staende[0]?.art === 'doppelt' ? staende[0].vorhanden : undefined

  /** Ablegen, was noch offen ist – oder, mit `trotzdem`, was schon in der Ablage liegt. */
  async function ablegen(trotzdem: boolean) {
    const auswahl = staende
      .map((stand, index) => ({ stand, index }))
      .filter(({ stand }) =>
        trotzdem ? stand.art === 'doppelt' : stand.art === 'offen' || stand.art === 'fehler',
      )
      .map(({ index }) => index)
    if (auswahl.length === 0) return

    const neu = [...staende]
    for (const [schritt, index] of auswahl.entries()) {
      const file = files[index] as File
      setLaeuft({ schritt: schritt + 1, von: auswahl.length })
      try {
        const { document } = await upload.mutateAsync({
          file,
          allowDuplicate: trotzdem,
          bereich: sicht.bereich,
          title: angaben.titel[index]?.trim() || undefined,
          categoryId: felder.includes('kategorie') ? angaben.categoryId : undefined,
          assignedTo: felder.includes('zustaendig') ? angaben.assignedTo : undefined,
          status: felder.includes('status') ? angaben.status : undefined,
        })
        // Fälligkeit und Notiz nimmt das Hochladen nicht an – sie gehen gleich
        // danach mit, bevor jemand das Dokument zu sehen bekommt.
        const faellig = sicht.faellig && angaben.faellig ? angaben.faellig : undefined
        const notiz = angaben.notiz.trim() || undefined
        if (faellig || notiz) {
          await api.updateDocument(document.id, {
            ...(faellig ? { dueDate: faellig } : {}),
            ...(notiz ? { notes: notiz } : {}),
          })
        }
        neu[index] = { art: 'abgelegt', dokument: document }
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'duplicate') {
          const data = error.data as { existing?: ManagedDocument } | undefined
          neu[index] = { art: 'doppelt', meldung: error.message, vorhanden: data?.existing }
        } else {
          neu[index] = {
            art: 'fehler',
            meldung: error instanceof Error ? error.message : 'Ablegen fehlgeschlagen.',
          }
        }
      }
      setStaende([...neu])
    }

    setLaeuft(null)
    void queryClient.invalidateQueries({ queryKey: ['documents'] })
    if (neu.every((stand) => stand.art === 'abgelegt')) {
      onAbgelegt(neu.flatMap((stand) => (stand.art === 'abgelegt' ? [stand.dokument] : [])))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onZurueck}
          disabled={busy}
          aria-label="Zurück zur Auswahl"
          className="-ml-2 grid size-11 place-items-center rounded-full text-2xl text-slate-500 disabled:opacity-40 dark:text-slate-400"
        >
          ‹
        </button>
        <h1 className="text-2xl font-bold">
          In {sicht.ablage === 'Sammlung' ? 'die Sammlung' : 'die Dokumente'}
        </h1>
      </div>

      {meldungen.length > 0 ? (
        <div className="space-y-1">
          {meldungen.map((meldung, index) => (
            <Hinweis key={index} text={meldung} />
          ))}
        </div>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {files.map((file, index) => {
          const abgelegt = staende[index]?.art === 'abgelegt'
          return (
            <label key={index} className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="min-w-0 truncate">
                  {files.length > 1 ? `Titel · ${file.name}` : 'Titel'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {abgelegt ? '✓ abgelegt' : formatFileSize(file.size)}
                </span>
              </span>
              <input
                value={angaben.titel[index] ?? ''}
                onChange={(event) =>
                  andere({
                    titel: angaben.titel.map((alt, at) =>
                      at === index ? event.target.value : alt,
                    ),
                  })
                }
                disabled={busy || abgelegt}
                maxLength={200}
                autoCapitalize="sentences"
                enterKeyHint="done"
                placeholder={titleFromFilename(file.name)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          )
        })}

        <div className={`grid gap-2 ${felder.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {felder.includes('kategorie') ? (
            <div className={felder.length > 1 ? 'col-span-2' : ''}>
              <CategorySelect
                categories={categories.data?.categories ?? []}
                bereich={sicht.bereich}
                value={angaben.categoryId ?? ''}
                disabled={busy}
                onChange={(value) => andere({ categoryId: value || null })}
              />
            </div>
          ) : null}
          {felder.includes('zustaendig') ? (
            <TraySelect
              label="Zuständig"
              value={angaben.assignedTo ?? ''}
              disabled={busy}
              onChange={(value) => andere({ assignedTo: value || null })}
              options={[
                { value: '', label: UNASSIGNED_LABEL },
                ...(users.data?.users ?? []).map((user) => ({ value: user.id, label: user.name })),
              ]}
            />
          ) : null}
          {felder.includes('status') ? (
            <TraySelect
              label="Status"
              value={angaben.status}
              disabled={busy}
              onChange={(value) => andere({ status: value as DocumentStatus })}
              options={DOCUMENT_STATUSES.map((status) => ({
                value: status,
                label: DOCUMENT_STATUS_LABELS[status],
              }))}
            />
          ) : null}
          {sicht.faellig ? (
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Fällig
              </span>
              <input
                type="date"
                value={angaben.faellig}
                onChange={(event) => andere({ faellig: event.target.value })}
                disabled={busy}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          ) : null}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Notiz
          </span>
          <textarea
            value={angaben.notiz}
            onChange={(event) => andere({ notiz: event.target.value })}
            disabled={busy}
            rows={2}
            maxLength={2000}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      </div>

      {nochOffen.length > 0 || busy ? (
        <button
          onClick={() => void ablegen(false)}
          disabled={busy}
          className={`min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-60 ${sicht.knopf}`}
        >
          {laeuft
            ? `Wird abgelegt${laeuft.von > 1 ? ` (${laeuft.schritt} von ${laeuft.von})` : ''} …`
            : nochOffen.some((stand) => stand.art === 'fehler')
              ? 'Nochmals versuchen'
              : 'Ablegen'}
        </button>
      ) : null}

      {doppelte.length > 0 && !busy ? (
        <div className="space-y-2">
          <button
            onClick={() => void ablegen(true)}
            className="min-h-12 w-full rounded-xl border border-slate-300 text-base font-semibold dark:border-slate-700"
          >
            Trotzdem ablegen
          </button>
          {vorhanden ? (
            <button
              onClick={() => onAbgelegt([vorhanden])}
              className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
            >
              Vorhandenes Dokument öffnen
            </button>
          ) : null}
        </div>
      ) : null}

      {abgelegte.length > 0 && abgelegte.length < files.length && !busy ? (
        <button
          onClick={() => onAbgelegt(abgelegte)}
          className="min-h-11 w-full rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          Fertig – ohne die übrigen
        </button>
      ) : null}
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
