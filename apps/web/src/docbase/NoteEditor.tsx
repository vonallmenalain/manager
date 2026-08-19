import type { Note, NoteColor } from '@manager/shared'
import { useRef, useState } from 'react'

import { CategorySelect } from '../components/CategoryPicker'
import { Modal, ModalCloseButton } from '../components/Modal'
import {
  BREITEN,
  BREITE_KLASSEN,
  COLOR_STYLES,
  ColorPicker,
  NoteText,
  WidthPicker,
  type Breite,
} from '../components/NoteParts'
import { saveStateLabel, useAutosave } from '../lib/autosave'
import { useCategories } from '../lib/documents'
import { useLocalSetting } from '../lib/einstellungen'
import { useDeleteNote, useSaveNote } from '../lib/household'

/**
 * Eine Notiz der Sammlung.
 *
 * Bis auf drei Dinge dieselbe Notiz wie im Haushalt – Autospeichern, Farbe,
 * Anheften, Verweise, die sich antippen lassen:
 *
 *  - Sie hat eine Kategorie. Das ist der eigentliche Grund, warum es sie hier
 *    gibt: Was man sich zu einer Studie notiert, gehört in dieselbe Schublade
 *    wie die Studie – und taucht dann unter demselben Häkchen wieder auf.
 *  - Sie ist immer Fliesstext. Eine Sammlung wird nachgeschlagen, nicht
 *    abgearbeitet; eine Liste zum Abhaken beantwortet hier keine Frage.
 *  - Sie ist immer für alle da. Wer die Sammlung öffnen darf, sieht alles
 *    darin; einen Schalter „nur für mich" gibt es deshalb nicht.
 */
export function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const save = useSaveNote()
  const remove = useDeleteNote()
  const categories = useCategories('docbase')

  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.body ?? '')
  const [categoryId, setCategoryId] = useState(note?.categoryId ?? '')
  /** Sobald eine neue Notiz einmal gespeichert ist, lässt sie sich löschen. */
  const [savedId, setSavedId] = useState(note?.id)
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'default')
  // Die Breite gehört zum Gerät, nicht zur Notiz: dieselbe Notiz will am
  // Monitor breit und am Handy schmal gelesen werden.
  const [breite, setBreite] = useLocalSetting<Breite>('docbase.notizbreite', BREITEN, 'standard')

  // Ab dem ersten Speichern wird dieselbe Notiz weitergeschrieben, statt eine
  // zweite anzulegen.
  const idRef = useRef(note?.id)

  const autosave = useAutosave(
    {
      title,
      body: text,
      kind: 'text' as const,
      bereich: 'docbase' as const,
      categoryId: categoryId || null,
      pinned,
      // Die Sammlung kennt kein „nur für mich": Was hier liegt, gehört allen,
      // die sie öffnen dürfen – sonst stünde neben einer Studie eine Notiz,
      // die der andere nicht sieht.
      shared: true,
      color,
    },
    async (entwurf) => {
      const result = await save.mutateAsync({ id: idRef.current, note: entwurf })
      idRef.current = result.note.id
      setSavedId(result.note.id)
    },
    // Der Server verlangt Titel oder Text. Eine leere Notiz wird deshalb nicht
    // angelegt und eine geleerte behält ihren letzten Stand.
    { savable: (entwurf) => entwurf.title.trim() !== '' || entwurf.body.trim() !== '' },
  )

  return (
    <Modal
      onClose={onClose}
      label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
      className={COLOR_STYLES[color]}
      width={BREITE_KLASSEN[breite]}
      header={
        <>
          <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {saveStateLabel(autosave.state)}
          </span>
          <div className="flex items-center gap-1">
            <ColorPicker color={color} onChange={setColor} akzent="text-teal-700" />
            <WidthPicker breite={breite} onChange={setBreite} />
            <button
              onClick={() => setPinned((value) => !value)}
              className={`grid size-11 min-h-11 place-items-center rounded-full text-sm ${pinned ? '' : 'opacity-30'}`}
              aria-label="Anheften"
              aria-pressed={pinned}
            >
              📌
            </button>
            <ModalCloseButton onClick={onClose} label="Notiz schliessen" />
          </div>
        </>
      }
      footer={
        savedId ? (
          <div className="flex items-center">
            <button
              onClick={() => {
                if (!window.confirm('Notiz löschen?')) return
                // Verhindert, dass das Speichern beim Schliessen die eben
                // gelöschte Notiz wieder anlegt.
                autosave.stop()
                remove.mutate(savedId, { onSuccess: onClose })
              }}
              className="ml-auto min-h-11 rounded-xl px-3 text-sm font-medium text-red-600 dark:text-red-400"
            >
              Löschen
            </button>
          </div>
        ) : undefined
      }
    >
      <>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Titel"
          aria-label="Titel"
          // Bei einer neuen Notiz steht der Finger schon über der Tastatur.
          autoFocus={!note}
          className="w-full bg-transparent text-lg font-semibold outline-none"
        />

        {/* Die Kategorie steht oben und nicht im Fuss: Sie entscheidet, wo die
            Notiz später auftaucht, und das gehört zum Anlegen dazu – nicht zum
            Aufräumen danach. „Neue Kategorie …" führt dabei zum selben Fenster
            wie bei einem Dokument. */}
        <div className="mt-3">
          <CategorySelect
            bereich="docbase"
            categories={categories.data?.categories ?? []}
            value={categoryId}
            onChange={setCategoryId}
          />
        </div>

        <NoteText value={text} onChange={setText} startInEditing={!note || text === ''} />
      </>
    </Modal>
  )
}
