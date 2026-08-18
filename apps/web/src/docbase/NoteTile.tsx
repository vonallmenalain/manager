import type { Note } from '@manager/shared'

import { NoteIcon } from '../components/icons'
import { COLOR_STYLES } from '../components/NoteParts'

/**
 * Eine Notiz in der Sammlung – als Kachel und als Zeile.
 *
 * Sie steht zwischen den Dokumenten, nicht in einer eigenen Liste daneben:
 * Was man sich zu einer Studie aufschreibt, sucht man dort, wo die Studie
 * liegt. Deshalb trägt sie denselben Aufbau wie eine Dokumentenkachel – Bild
 * oben, Titel und Einordnung unten – und dieselbe Kategorie darunter.
 *
 * Woran man sie trotzdem erkennt: an ihrer Farbe und am Zeichen oben rechts.
 * Wo beim Dokument die erste Seite steht, steht bei ihr der Anfang ihres
 * Textes – auch das ist eine Vorschau, nur eben aus Buchstaben.
 *
 * Ein Knopf und kein Verweis: Die Notiz geht als Fenster über der Sammlung
 * auf, genau wie im Manager, statt eine eigene Adresse zu bekommen.
 */
export function NoteTile({
  note,
  categoryName,
  onOpen,
}: {
  note: Note
  categoryName?: string
  onOpen: () => void
}) {
  return (
    <li>
      <button
        onClick={onOpen}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition active:scale-[0.99] ${COLOR_STYLES[note.color]}`}
      >
        {/* Dasselbe Seitenverhältnis wie bei einem Dokument: In einer Reihe
            aus beidem soll keine Kachel aus der Reihe fallen. */}
        <span className="block aspect-3/4 w-full overflow-hidden border-b border-black/5 p-2 dark:border-white/10">
          <span className="block whitespace-pre-wrap break-words text-[11px] leading-snug text-slate-600 dark:text-slate-300">
            {/* Die Zeichen schwimmen im Text mit, statt darüber zu liegen: Auf
                einer Kachel von achtzig Bildpunkten Breite verdeckte ein Zeichen
                in der Ecke sonst genau die Wörter, wegen derer man hinschaut. */}
            <span className="float-right ml-1 flex items-center gap-0.5 text-slate-400">
              {note.pinned ? (
                <span className="text-[10px]" title="Angeheftet">
                  📌
                </span>
              ) : null}
              <NoteIcon className="size-4" />
            </span>
            {note.body || <span className="text-slate-400">Ohne Text</span>}
          </span>
        </span>

        <span className="min-w-0 flex-1 p-2">
          {/* break-words wie bei der Dokumentenkachel: Bei vier Kacheln pro
              Reihe ist jedes längere Wort breiter als die Kachel. */}
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug">
            {note.title || <span className="text-slate-400">Ohne Titel</span>}
          </span>
          <span className="mt-0.5 line-clamp-2 break-words text-xs text-slate-500 dark:text-slate-400">
            {note.updatedAt.slice(0, 10)}
            {categoryName ? ` · ${categoryName}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Dieselbe Notiz als Zeile – wie die Zeile eines Dokuments aufgebaut. */
export function NoteRow({
  note,
  categoryName,
  onOpen,
}: {
  note: Note
  categoryName?: string
  onOpen: () => void
}) {
  return (
    <li>
      <button
        onClick={onOpen}
        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${COLOR_STYLES[note.color]}`}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          <NoteIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {note.title || <span className="text-slate-400">Ohne Titel</span>}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {/* Dasselbe Datum in derselben Schreibweise wie beim Dokument
                daneben: In einer gemischten Liste sind zwei Datumsformate
                zwei Arten zu lesen, wo eine genügt. */}
            Notiz · {note.updatedAt.slice(0, 10)}
            {categoryName ? ` · ${categoryName}` : ''}
          </span>
          {note.body ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
              {note.body}
            </span>
          ) : null}
        </span>
        {note.pinned ? (
          <span className="shrink-0 text-xs" title="Angeheftet">
            📌
          </span>
        ) : null}
      </button>
    </li>
  )
}
