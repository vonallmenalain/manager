import {
  richValueOf,
  type Note,
  type NoteColor,
  type NoteKind,
  type RichValue,
} from '@manager/shared'
import { useRef, useState } from 'react'

import { CategorySelect } from '../components/CategoryPicker'
import { alsNotiz, Checklist, eintraegeAus, type Eintrag } from '../components/Checklist'
import { Modal, ModalCloseButton } from '../components/Modal'
import {
  BREITEN,
  BREITE_KLASSEN,
  COLOR_STYLES,
  ColorPicker,
  DateiKnopf,
  gleicherInhalt,
  NoteText,
  NoteTitle,
  useSpeicherstand,
  VerlaufKnoepfe,
  WidthPicker,
  type Breite,
  type NoteTextHandle,
  type NotizInhalt,
} from '../components/NoteParts'
import type { Aenderung } from '../components/RichTextField'
import { useAutosave } from '../lib/autosave'
import { useCategories } from '../lib/documents'
import { useLocalSetting } from '../lib/einstellungen'
import { useDeleteNote, useSaveNote } from '../lib/household'
import { useVerlauf, useVerlaufTasten } from '../lib/verlauf'

/**
 * Eine Notiz der Sammlung.
 *
 * Bis auf zwei Dinge dieselbe Notiz wie im Haushalt – Autospeichern, Farbe,
 * Anheften, Verweise, die sich antippen lassen, Text oder Checkliste,
 * Rückgängig:
 *
 *  - Sie hat eine Kategorie. Das ist der eigentliche Grund, warum es sie hier
 *    gibt: Was man sich zu einer Studie notiert, gehört in dieselbe Schublade
 *    wie die Studie – und taucht dann unter demselben Häkchen wieder auf.
 *  - Sie ist immer für alle da. Wer die Sammlung öffnen darf, sieht alles
 *    darin; einen Schalter „nur für mich" gibt es deshalb nicht.
 *
 * Eine Checkliste gibt es hier erst seit Kurzem: Auch in einer Sammlung steht
 * manches, das sich abhaken lässt – die Fragen an die Ärztin, die Tasche fürs
 * Spital.
 */
export function NoteEditor({
  note,
  newKind = 'text',
  onClose,
  onGeloescht,
}: {
  note: Note | null
  /** Was eine neue Notiz wird – die Art bleibt danach, was sie ist. */
  newKind?: NoteKind
  onClose: () => void
  /** Nach dem Löschen – die Sammlung bietet dann „Rückgängig" an. */
  onGeloescht?: (note: { id: string; title: string }) => void
}) {
  const save = useSaveNote()
  const remove = useDeleteNote()
  const categories = useCategories('docbase')

  const kind = note?.kind ?? newKind
  // Titel, Text und Einträge mit ihrem Verlauf – wie im Haushalt.
  const verlauf = useVerlauf<NotizInhalt>(
    () => ({
      title: note?.title ?? '',
      text: kind === 'liste' ? richValueOf('', null) : richValueOf(note?.body, note?.bodyRich),
      items: kind === 'liste' ? eintraegeAus(note?.body ?? '', note?.bodyRich) : [],
    }),
    gleicherInhalt,
  )
  useVerlaufTasten(verlauf.undo, verlauf.redo)
  const { title, text, items } = verlauf.value
  const setTitle = (value: string) => verlauf.set((alt) => ({ ...alt, title: value }), 'titel')
  const setText = (value: RichValue, art?: Aenderung) =>
    verlauf.set((alt) => ({ ...alt, text: value }), art === 'tippen' ? 'text' : undefined)
  const setItems = (update: (items: Eintrag[]) => Eintrag[], gruppe?: string) =>
    verlauf.set((alt) => ({ ...alt, items: update(alt.items) }), gruppe)
  const liste = kind === 'liste' ? alsNotiz(items) : null

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
  const texte = useRef<NoteTextHandle>(null)

  const autosave = useAutosave(
    {
      title,
      body: liste ? liste.body : text.text,
      bodyRich: liste ? liste.bodyRich : text.rich,
      kind,
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
  const speicherstand = useSpeicherstand(autosave.state)

  return (
    <Modal
      onClose={onClose}
      label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
      className={COLOR_STYLES[color]}
      width={BREITE_KLASSEN[breite]}
      header={
        <>
          <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {speicherstand}
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
      // Links die Büroklammer, rechts Rückgängig und Löschen – wie im Haushalt.
      footer={
        <div className="flex items-center gap-1">
          {kind !== 'liste' ? <DateiKnopf onClick={() => texte.current?.dateiEinfuegen()} /> : null}
          <div className="ml-auto flex items-center gap-1">
            <VerlaufKnoepfe
              canUndo={verlauf.canUndo}
              canRedo={verlauf.canRedo}
              onUndo={verlauf.undo}
              onRedo={verlauf.redo}
            />
            {savedId ? (
              <button
                onClick={() => {
                  // Ohne Rückfrage – danach steht „Rückgängig" bereit. Das
                  // Speichern beim Schliessen darf die Notiz nicht wieder anlegen.
                  autosave.stop()
                  remove.mutate(savedId, {
                    onSuccess: () => {
                      onClose()
                      onGeloescht?.({ id: savedId, title })
                    },
                  })
                }}
                disabled={remove.isPending}
                className="min-h-11 rounded-xl px-3 text-sm font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
              >
                Löschen
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <>
        {/* Bei einer neuen Notiz steht der Finger schon über der Tastatur. */}
        <NoteTitle value={title} onChange={setTitle} autoFocus={!note} />

        {/* Die Kategorie steht oben und nicht im Fuss: Sie entscheidet, wo die
            Notiz später auftaucht, und das gehört zum Anlegen dazu – nicht zum
            Aufräumen danach. „Neue Kategorie …" führt dabei zum selben Fenster
            wie bei einem Dokument. Ohne „Kategorie" darüber: Was in der
            Auswahl steht, sagt das schon. */}
        <div className="mt-3">
          <CategorySelect
            beschriftet={false}
            bereich="docbase"
            categories={categories.data?.categories ?? []}
            value={categoryId}
            onChange={setCategoryId}
          />
        </div>

        {kind === 'liste' ? (
          <Checklist items={items} onChange={setItems} akzent="teal" />
        ) : (
          <NoteText
            ref={texte}
            value={text}
            onChange={setText}
            startInEditing={!note || text.text === ''}
            akzent="teal"
            bereich="docbase"
          />
        )}
      </>
    </Modal>
  )
}
