import {
  applyMark,
  autoListBlock,
  changeIndent,
  clearMarks,
  docOfValue,
  editTextOf,
  fileBeside,
  listStateAt,
  marksAt,
  normalizeDoc,
  replaceRange,
  toggleList,
  toRichValue,
  TEXT_SIZE_LABELS,
  withWritingLines,
  wordRangeAt,
  type MarkKey,
  type RichDoc,
  type RichFile,
  type RichMarks,
  type RichValue,
} from '@manager/shared'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'

import { thumbnailUrl } from '../lib/noteFiles'
import {
  docFromDom,
  fileElementOf,
  needsNormalize,
  placeCaretAtPoint,
  readFileAttr,
  renderDocInto,
  revealCaret,
  selectionOffsets,
  setSelectionOffsets,
} from '../lib/richdom'
import { BG_COLORS, TEXT_COLORS } from '../lib/richStyles'

/**
 * Das Textfeld mit Formatierung – Tippen wie in jedem Feld, dazu ein kleines
 * Menü für Fett, Kursiv, Grösse, Farben und Aufzählungen. Übernommen aus der
 * BSS-App, ohne deren Erwähnungen und Zuordnungen.
 *
 * Es ist ein `contentEditable`, aber eines an kurzer Leine: Der Browser darf
 * tippen, löschen und Zeilen umbauen, wie er es gewohnt ist – nach jeder
 * Eingabe liest das Feld den Stand zurück ins Modell (`lib/richdom`). Eigene
 * Handgriffe (eine Marke, ein Einzug, Einfügen) rechnen auf dem Modell und
 * bauen das Feld neu auf, den Cursor an derselben Stelle. Im Feld steht
 * dadurch nie ein Steuerzeichen – man sieht genau, was nachher dasteht.
 *
 * Das Feld wächst mit seinem Text; gerollt wird im Fenster darum herum. Anders
 * als beim früheren Textfeld muss dafür nichts gemessen werden – das Messen
 * war es, was das Fenster bei jedem Tastendruck an den Anfang der Notiz
 * zurückwarf.
 *
 * Ohne Auswahl wirkt eine Marke auf das Wort unter dem Cursor; `Tab` und
 * `Shift+Tab` rücken Listenpunkte ein und aus, `Ctrl+B`/`I`/`U` wie gewohnt.
 */

/** Die Farbe der Knöpfe – marineblau im Haushalt, petrol in der DocBase. */
export type Akzent = 'brand' | 'teal'

const AKZENT: Record<Akzent, { offen: string; aktiv: string; ring: string }> = {
  brand: {
    offen:
      'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900 dark:text-brand-200',
    aktiv: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
    ring: 'ring-brand-500',
  },
  teal: {
    offen:
      'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-900 dark:text-teal-200',
    aktiv: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100',
    ring: 'ring-teal-500',
  },
}

/**
 * Wo der Cursor beim Erscheinen hingehört: an den Punkt, auf den getippt
 * wurde, an eine Stelle im Text (nach dem Einfügen einer Datei: die Zeile
 * darunter) oder ans Ende. Ohne Angabe steht das Feld still da, bis man es
 * antippt – etwa bei einer neuen Notiz, deren Titel den Cursor hat.
 */
export type Einstieg = { x: number; y: number } | { offset: number } | 'ende'

/** Was das Feld von aussen preisgibt: wo der Cursor steht. */
export interface RichTextFieldHandle {
  /** Die Cursorstelle im Bearbeitungstext – `null`, wenn er nicht im Feld steht. */
  caret: () => number | null
}

/**
 * Das Modell, wie es im Feld steht: um jede Datei eine Zeile zum Schreiben
 * (siehe `withWritingLines`).
 */
const fieldDocOf = (value: RichValue) => withWritingLines(docOfValue(value))

/** Wie die Auswahl gerade aussieht – der Stand für das Menü. */
interface MenuState {
  marks: RichMarks
  list: { active: boolean; level: number }
  hasSelection: boolean
}

const EMPTY_MENU: MenuState = { marks: {}, list: { active: false, level: 0 }, hasSelection: false }

const signature = (value: RichValue) => `${value.rich ?? ''}\u0000${value.text}`

/**
 * Wer im Menü etwas antippt, soll die Auswahl im Feld behalten – deshalb
 * nehmen der Knopf und das ganze Menü den Fokus gar nicht erst an. So bleibt
 * auch die Tastatur offen.
 */
const holdFocus = (event: { preventDefault: () => void }) => event.preventDefault()

export function RichTextField({
  value,
  onChange,
  onBlur,
  einstieg,
  placeholder,
  className = '',
  wrapperClassName = '',
  akzent = 'brand',
  onOpenFile,
  onRemoveFile,
  onDateiEinfuegen,
  ref,
  'aria-label': ariaLabel,
}: {
  value: RichValue
  onChange: (next: RichValue) => void
  /** Läuft nach dem Verlassen des Feldes – nie beim Griff ins Menü */
  onBlur?: () => void
  einstieg?: Einstieg | null
  placeholder?: string
  /** Klassen für das Feld selbst – es soll aussehen wie der gelesene Text */
  className?: string
  /** Klassen für die Hülle – der Abstand nach aussen, damit der Knopf bündig sitzt */
  wrapperClassName?: string
  akzent?: Akzent
  /** Antippen einer Datei im Text – öffnet sie. */
  onOpenFile?: (file: RichFile) => void
  /** Das Kreuz an einer Datei. Die Rückfrage und das Entfernen macht, wer das Feld hält. */
  onRemoveFile?: (file: RichFile) => void
  /** „Datei einfügen" im Menü – ohne Angabe steht der Eintrag nicht da. */
  onDateiEinfuegen?: () => void
  ref?: Ref<RichTextFieldHandle>
  'aria-label'?: string
}) {
  const farben = AKZENT[akzent]
  const rootRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<RichDoc>(fieldDocOf(value))
  /** Der zuletzt selbst gemeldete Stand – nur Fremdes baut das Feld neu auf. */
  const emitted = useRef<string | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuOpenRef = useRef(false)
  const [menu, setMenu] = useState<MenuState>(EMPTY_MENU)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Wo das Menü am Bildschirm steht – am Knopf ausgerichtet (siehe unten). */
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; maxHeight: number } | null>(
    null,
  )
  /** Der Knopf zum Formatieren steht nur da, solange geschrieben wird. */
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef<number | undefined>(undefined)

  /** Der Platzhalter braucht ein Zeichen am Feld, solange nichts drinsteht. */
  const updateEmpty = (root: HTMLElement, doc: RichDoc) => {
    if (editTextOf(doc) === '') root.setAttribute('data-rt-empty', 'true')
    else root.removeAttribute('data-rt-empty')
  }

  /*
   * Das Feld folgt dem Wert nur, wenn der Wert nicht vom Feld selbst stammt:
   * Während getippt wird, gehört das DOM dem Browser – es bei jeder eigenen
   * Meldung neu aufzubauen, risse den Cursor mitten aus dem Wort.
   */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const sig = signature(value)
    if (emitted.current === sig) return
    emitted.current = sig
    const doc = fieldDocOf(value)
    docRef.current = doc
    renderDocInto(root, doc, { thumbnail: thumbnailUrl })
    updateEmpty(root, doc)
  })

  useImperativeHandle(
    ref,
    () => ({
      caret: () => {
        const root = rootRef.current
        const sel = root ? selectionOffsets(root) : null
        return sel ? sel.end : null
      },
    }),
    [],
  )

  /*
   * Anwählen, ohne dass das Fenster springt: `preventScroll`, weil der Browser
   * sonst das ganze Feld „ins Bild holt" – bei einer langen Notiz heisst das,
   * an ihren Anfang. Danach steht der Cursor dort, wo getippt wurde, und nur
   * wenn der nicht im Bild ist (Einstieg ans Ende), wird zu ihm gerollt – ohne
   * Zugabe: Wer eben auf eine Zeile getippt hat, soll sie dort behalten.
   */
  const einstiegRef = useRef(einstieg)
  useLayoutEffect(() => {
    const start = einstiegRef.current
    const root = rootRef.current
    if (!start || !root) return
    root.focus({ preventScroll: true })
    if (start !== 'ende' && 'offset' in start) {
      // Nach dem Einfügen: die Zeile unter dem Eingefügten, mit etwas Luft im
      // Bild – man soll sehen, was eben dazukam.
      setSelectionOffsets(root, start.offset, start.offset)
      revealCaret(root)
      return
    }
    if (start === 'ende' || !placeCaretAtPoint(root, start.x, start.y)) {
      const length = editTextOf(docRef.current).length
      setSelectionOffsets(root, length, length)
    }
    revealCaret(root, 0)
  }, [])

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  /*
   * Rücktaste und Entf an einer Datei tun nichts. Der Browser löschte sonst
   * die ganze Datei mit einem Tastendruck (siehe `fileBeside`); entfernt wird
   * sie über ihr Kreuz, mit Rückfrage.
   *
   * Über `beforeinput` und nicht über die Tasten: Die Handytastatur meldet
   * ihre Rücktaste nicht als Taste, sondern nur als Eingabe, die gleich
   * geschehen wird – und die lässt sich hier noch abwenden.
   */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const guard = (event: InputEvent) => {
      const backward = event.inputType === 'deleteContentBackward'
      if (!backward && event.inputType !== 'deleteContentForward') return
      const sel = selectionOffsets(root)
      if (!sel || sel.start !== sel.end) return
      if (fileBeside(docRef.current, sel.start, backward ? -1 : 1)) event.preventDefault()
    }
    root.addEventListener('beforeinput', guard)
    return () => root.removeEventListener('beforeinput', guard)
  }, [])

  const emit = (doc: RichDoc) => {
    docRef.current = doc
    const next = toRichValue(doc)
    emitted.current = signature(next)
    onChange(next)
  }

  /** Die Auswahl im Feld – ohne Auswahl das Feldende. */
  const currentSelection = (): { start: number; end: number } => {
    const root = rootRef.current
    const sel = root ? selectionOffsets(root) : null
    if (sel) return sel
    const length = editTextOf(docRef.current).length
    return { start: length, end: length }
  }

  const menuStateNow = (): MenuState => {
    const { start, end } = currentSelection()
    const doc = docRef.current
    return {
      marks: marksAt(doc, start, end),
      list: listStateAt(doc, start, end),
      hasSelection: start !== end,
    }
  }
  const menuStateRef = useRef(menuStateNow)
  menuStateRef.current = menuStateNow

  // `selectionchange` ist das einzige Ereignis, das auch Pfeiltasten und
  // Griffe mit dem Finger meldet – es läuft am Dokument, nicht am Feld.
  useEffect(() => {
    const handler = () => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root || !selection?.anchorNode || !root.contains(selection.anchorNode)) return
      if (menuOpenRef.current) setMenu(menuStateRef.current())
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  /*
   * Geht die Tastatur auf, wird der sichtbare Teil des Bildschirms kleiner,
   * ohne dass getippt wurde – der Cursor rutscht dabei leicht unter die
   * Tastatur. Deshalb wird auch dann nachgerechnet.
   */
  useEffect(() => {
    const viewport = window.visualViewport
    if (!focused || !viewport) return
    const follow = () => {
      const root = rootRef.current
      if (root) revealCaret(root)
    }
    viewport.addEventListener('resize', follow)
    return () => viewport.removeEventListener('resize', follow)
  }, [focused])

  /**
   * Ein eigener Handgriff: Modell rechnen, Feld neu aufbauen, Cursor zurück.
   */
  const applyDoc = (doc: RichDoc, start: number, end: number) => {
    const root = rootRef.current
    if (!root) return
    const normal = withWritingLines(normalizeDoc(doc))
    renderDocInto(root, normal, { thumbnail: thumbnailUrl })
    setSelectionOffsets(root, start, end)
    emit(normal)
    updateEmpty(root, normal)
    if (menuOpenRef.current) setMenu(menuStateNow())
  }

  /*
   * Läuft gerade eine Zeicheneingabe über mehrere Tasten (Handytastatur,
   * Diktat, Autokorrektur), darf das Feld nicht unter der Eingabe neu
   * gezeichnet werden – das risse die Komposition ab. Aufgeräumt wird dann,
   * sobald sie abgeschlossen ist.
   */
  const composing = useRef(false)

  const handleInput = () => {
    const root = rootRef.current
    if (!root) return
    const doc = docFromDom(root)

    // Ging die Zeile neben einer Datei verloren (eine Auswahl über sie hinweg
    // gelöscht), kommt sie gleich wieder – sonst gäbe es dort keinen Platz
    // mehr zum Schreiben.
    if (!composing.current && withWritingLines(doc) !== doc) {
      const length = editTextOf(doc).length
      const caretNow = selectionOffsets(root) ?? { start: length, end: length }
      applyDoc(doc, caretNow.start, caretNow.end)
      revealCaret(root)
      return
    }

    // „- " am Zeilenanfang wird zur Aufzählung – die zwei Zeichen waren
    // Befehl, nicht Text (siehe `autoListBlock`).
    if (!composing.current) {
      const sel = selectionOffsets(root)
      if (sel && sel.start === sel.end) {
        const auto = autoListBlock(doc, sel.start)
        if (auto) {
          applyDoc(auto.doc, auto.caret, auto.caret)
          revealCaret(root)
          return
        }
      }
    }

    /*
     * Hat der Browser fremdes Markup eingesetzt – Chromes „wiederbelebter"
     * Tippstil nach dem Löschen formatierten Texts, das B/I/U einer
     * Auswahlleiste –, wird das Feld sofort aus dem Modell neu gezeichnet,
     * den Cursor an derselben Stelle. Neu Getipptes ist damit schlicht
     * unformatiert, statt eine geratene Farbe zu tragen.
     */
    if (!composing.current && needsNormalize(root)) {
      const length = editTextOf(doc).length
      const caretNow = selectionOffsets(root) ?? { start: length, end: length }
      applyDoc(doc, caretNow.start, caretNow.end)
      revealCaret(root)
      return
    }

    emit(doc)
    updateEmpty(root, doc)
    if (menuOpenRef.current) setMenu(menuStateNow())
    revealCaret(root)
  }

  /**
   * Eine Marke setzen oder nehmen. Ohne Auswahl wirkt sie auf das Wort unter
   * dem Cursor – auf Weissraum bewirkt sie nichts.
   */
  const applyInline = (key: MarkKey, pick: (marks: RichMarks) => true | string | null) => {
    const doc = docRef.current
    let { start, end } = currentSelection()
    if (start === end) {
      const word = wordRangeAt(editTextOf(doc), start)
      if (!word) return
      start = word.start
      end = word.end
    }
    applyDoc(applyMark(doc, start, end, key, pick(marksAt(doc, start, end))), start, end)
  }

  const toggleBold = () => applyInline('b', (marks) => (marks.b ? null : true))
  const toggleItalic = () => applyInline('i', (marks) => (marks.i ? null : true))
  const toggleUnderline = () => applyInline('u', (marks) => (marks.u ? null : true))
  const setSize = (key: string | null) => applyInline('size', () => key)
  const setColor = (key: string | null) => applyInline('color', () => key)
  const setBg = (key: string | null) => applyInline('bg', () => key)

  const doToggleList = () => {
    const { start, end } = currentSelection()
    applyDoc(toggleList(docRef.current, start, end), start, end)
  }

  const doIndent = (delta: 1 | -1) => {
    const { start, end } = currentSelection()
    applyDoc(changeIndent(docRef.current, start, end, delta), start, end)
  }

  const doClear = () => {
    const doc = docRef.current
    let { start, end } = currentSelection()
    if (start === end) {
      const word = wordRangeAt(editTextOf(doc), start)
      if (!word) return
      start = word.start
      end = word.end
    }
    applyDoc(clearMarks(doc, start, end), start, end)
  }

  /* ---------------- Tasten ---------------- */

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && menuOpenRef.current) {
      // Escape schliesst zuerst das Menü – nicht gleich das ganze Fenster.
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }

    // Die drei Klassiker selbst übernehmen – der Browser soll kein eigenes
    // Markup einsetzen, das am Modell vorbeiginge.
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase()
      const action =
        key === 'b' ? toggleBold : key === 'i' ? toggleItalic : key === 'u' ? toggleUnderline : null
      if (action) {
        event.preventDefault()
        action()
        return
      }
    }

    if (event.key === 'Tab') {
      const { start, end } = currentSelection()
      if (listStateAt(docRef.current, start, end).active) {
        event.preventDefault()
        doIndent(event.shiftKey ? -1 : 1)
      }
    }
  }

  /*
   * Eingefügt wird als Text, nicht als fremdes HTML: Was aus Word oder einer
   * Webseite kommt, brächte Schriften, Farben und Tabellen mit, die das Feld
   * nicht kennt und das Modell wegwerfen müsste. Der Text erbt stattdessen
   * die Marken der Einfügestelle – wie weitergetippt.
   */
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    if (!text) return
    const { start, end } = currentSelection()
    const { doc, caret } = replaceRange(docRef.current, start, end, text)
    applyDoc(doc, caret, caret)
    const root = rootRef.current
    if (root) revealCaret(root)
  }

  /* ---------------- Dateien ---------------- */

  /*
   * Eine Datei nimmt beim Drücken den Fokus nicht an. Sonst verlöre das Feld
   * ihn schon hier, würde zum gelesenen Text – und der Klick danach träfe ein
   * Element, das es nicht mehr gibt: Die Datei ginge nicht auf, und das Kreuz
   * fragte nie nach. Den Fokus gibt erst ab, wer die Datei dann öffnet.
   */
  const handleFileMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (root && fileElementOf(event.target, root)) event.preventDefault()
  }

  const handleFileClick = (event: MouseEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (!root) return
    const box = fileElementOf(event.target, root)
    if (!box) return
    event.preventDefault()
    const file = readFileAttr(box)
    if (!file) return
    if ((event.target as Element).closest('[data-rt-remove]')) onRemoveFile?.(file)
    else onOpenFile?.(file)
  }

  /* ---------------- Menü ---------------- */

  const closeMenu = () => {
    setMenuOpen(false)
    menuOpenRef.current = false
  }

  /**
   * Das Menü am Knopf ausrichten – als festes Element am Bildschirm.
   *
   * Es hängt bewusst **nicht** im Feld: Dort läge es im Rollbereich des
   * Fensters und machte den Inhalt höher, bloss weil ein Menü offen ist.
   * Deshalb hängt es am Ende des Dokuments (`createPortal`) und wird hier am
   * Knopf ausgerichtet; die Höhe endet am unteren Rand des sichtbaren
   * Bereichs – über der Tastatur –, darüber hinaus rollt es in sich.
   */
  const placeMenu = useCallback(() => {
    const button = buttonRef.current
    if (!button || !button.isConnected) {
      setMenuOpen(false)
      menuOpenRef.current = false
      return
    }
    const rect = button.getBoundingClientRect()
    const viewport = window.visualViewport
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
    const top = rect.bottom + 6
    setMenuPos({
      top,
      right: Math.max(8, document.documentElement.clientWidth - rect.right),
      maxHeight: Math.max(160, Math.min(440, bottom - top - 8)),
    })
  }, [])

  const toggleMenu = () => {
    const next = !menuOpenRef.current
    menuOpenRef.current = next
    if (next) {
      setMenu(menuStateNow())
      placeMenu()
    }
    setMenuOpen(next)
  }

  // Rollt oder verändert sich die Seite hinter dem offenen Menü, folgt es
  // seinem Knopf – nur das Rollen im Menü selbst ist keine Bewegung der Seite.
  useEffect(() => {
    if (!menuOpen) return
    const follow = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      placeMenu()
    }
    const viewport = window.visualViewport
    window.addEventListener('resize', follow)
    viewport?.addEventListener('resize', follow)
    document.addEventListener('scroll', follow, true)
    return () => {
      window.removeEventListener('resize', follow)
      viewport?.removeEventListener('resize', follow)
      document.removeEventListener('scroll', follow, true)
    }
  }, [menuOpen, placeMenu])

  return (
    <div className={`relative ${wrapperClassName}`}>
      {/*
        Der Griff zum Formatieren – klein in der oberen Ecke, solange
        geschrieben wird. Er klebt am oberen Rand des sichtbaren Bereichs
        (`sticky`): In einer langen Notiz schreibt man weit unten, und ein
        Knopf, der mit dem Anfang des Textes aus dem Bild rollt, wäre genau
        dann weg, wenn man ihn braucht. Die Leiste selbst ist null hoch und
        schiebt deshalb keine Zeile nach unten.
      */}
      {focused || menuOpen ? (
        <div className="pointer-events-none sticky top-0 z-10 -mr-2 flex h-0 justify-end">
          <button
            ref={buttonRef}
            type="button"
            onMouseDown={holdFocus}
            onClick={toggleMenu}
            aria-label="Text formatieren"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            title="Formatieren"
            className={`pointer-events-auto mt-1 grid size-8 place-items-center rounded-full border shadow-sm transition ${
              menuOpen
                ? farben.offen
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <FormatIcon />
          </button>
        </div>
      ) : null}

      <div
        ref={rootRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        spellCheck
        className={`rt-editor whitespace-pre-wrap break-words outline-none ${className}`}
        onInput={handleInput}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          handleInput()
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseDown={handleFileMouseDown}
        onClick={handleFileClick}
        // Hineingezogenes käme als fremdes HTML – dafür gilt dasselbe wie beim
        // Einfügen, nur dass sich der Weg nicht abfangen lässt.
        onDrop={(event) => event.preventDefault()}
        onFocus={() => {
          window.clearTimeout(blurTimer.current)
          setFocused(true)
        }}
        onBlur={(event) => {
          setFocused(false)
          blurTimer.current = window.setTimeout(closeMenu, 150)
          if (!event.currentTarget.isConnected) return
          onBlur?.()
        }}
      />

      {menuOpen && menuPos
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Formatieren"
              onMouseDown={holdFocus}
              style={{ top: menuPos.top, right: menuPos.right, maxHeight: menuPos.maxHeight }}
              className="fixed z-[60] w-76 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {/* Die häufigsten Griffe in einer Zeile: die drei Klassiker und
                  die Aufzählung. Die Tastenkürzel (Ctrl+B/I/U) gelten weiter. */}
              <div className="flex gap-1 pb-1">
                <Toggle
                  label="Fett"
                  active={menu.marks.b === true}
                  onClick={toggleBold}
                  farben={farben}
                >
                  <span className="text-base font-bold">B</span>
                </Toggle>
                <Toggle
                  label="Kursiv"
                  active={menu.marks.i === true}
                  onClick={toggleItalic}
                  farben={farben}
                >
                  <span className="font-serif text-base italic">I</span>
                </Toggle>
                <Toggle
                  label="Unterstrichen"
                  active={menu.marks.u === true}
                  onClick={toggleUnderline}
                  farben={farben}
                >
                  <span className="text-base underline underline-offset-2">U</span>
                </Toggle>
                <Toggle
                  label="Aufzählung"
                  active={menu.list.active}
                  onClick={doToggleList}
                  farben={farben}
                >
                  <ListIcon />
                </Toggle>
              </div>

              <MenuLabel>Textgrösse</MenuLabel>
              {/* Vier feste Stufen, kein freies Mass. Das „A" zeigt die Stufe;
                  nochmaliges Antippen stellt auf Normal zurück. */}
              <div className="flex items-end gap-1 pb-1">
                <SizeButton
                  label={TEXT_SIZE_LABELS.s}
                  sample="text-xs"
                  active={menu.marks.size === 's'}
                  onClick={() => setSize(menu.marks.size === 's' ? null : 's')}
                  farben={farben}
                />
                <SizeButton
                  label="Normal"
                  sample="text-sm"
                  active={!menu.marks.size}
                  onClick={() => setSize(null)}
                  farben={farben}
                />
                <SizeButton
                  label={TEXT_SIZE_LABELS.l}
                  sample="text-base"
                  active={menu.marks.size === 'l'}
                  onClick={() => setSize(menu.marks.size === 'l' ? null : 'l')}
                  farben={farben}
                />
                <SizeButton
                  label={TEXT_SIZE_LABELS.xl}
                  sample="text-lg"
                  active={menu.marks.size === 'xl'}
                  onClick={() => setSize(menu.marks.size === 'xl' ? null : 'xl')}
                  farben={farben}
                />
              </div>

              <MenuLabel>Textfarbe</MenuLabel>
              <div className="flex flex-wrap items-center gap-0.5 px-1 pb-1.5">
                {TEXT_COLORS.map((color) => (
                  <ColorDot
                    key={color.key}
                    label={color.label}
                    dotClass={color.dot}
                    active={menu.marks.color === color.key}
                    onClick={() => setColor(menu.marks.color === color.key ? null : color.key)}
                    farben={farben}
                  />
                ))}
                <ClearDot label="Keine Textfarbe" onClick={() => setColor(null)} />
              </div>

              <MenuLabel>Hintergrund</MenuLabel>
              <div className="flex flex-wrap items-center gap-0.5 px-1 pb-1.5">
                {BG_COLORS.map((color) => (
                  <ColorDot
                    key={color.key}
                    label={color.label}
                    dotClass={color.dot}
                    active={menu.marks.bg === color.key}
                    onClick={() => setBg(menu.marks.bg === color.key ? null : color.key)}
                    farben={farben}
                  />
                ))}
                <ClearDot label="Kein Hintergrund" onClick={() => setBg(null)} />
              </div>

              {/* Ein- und Ausrücken gehört zur Aufzählung – ausserhalb einer
                  Liste gibt es nichts einzurücken. */}
              {menu.list.active ? (
                <div className="flex gap-1 pb-1">
                  <MenuButton onClick={() => doIndent(1)}>
                    <IndentIcon />
                    Einrücken
                  </MenuButton>
                  <MenuButton onClick={() => doIndent(-1)}>
                    <OutdentIcon />
                    Ausrücken
                  </MenuButton>
                </div>
              ) : null}

              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              <MenuButton onClick={doClear} wide>
                <ClearFormatIcon />
                Formatierung entfernen
              </MenuButton>

              {onDateiEinfuegen ? (
                <MenuButton
                  onClick={() => {
                    closeMenu()
                    onDateiEinfuegen()
                  }}
                  wide
                >
                  <PaperclipIcon />
                  Datei einfügen
                </MenuButton>
              ) : null}

              {!menu.hasSelection ? (
                <p className="px-2 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Ohne Auswahl wirkt alles auf das Wort unter dem Cursor, die Aufzählung auf die
                  ganze Zeile.
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Menü-Bausteine                                                      */
/* ------------------------------------------------------------------ */

type Farben = (typeof AKZENT)[Akzent]

/** Ein Knopf der oberen Zeile – nur das Zeichen, der Name als Beschriftung. */
function Toggle({
  label,
  active,
  onClick,
  farben,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  farben: Farben
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={holdFocus}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid h-10 flex-1 place-items-center rounded-lg transition ${
        active
          ? farben.aktiv
          : 'text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-700/60'
      }`}
    >
      {children}
    </button>
  )
}

/** Eine Grössenstufe – ein „A" in ebendieser Grösse, der Name als Beschriftung. */
function SizeButton({
  label,
  sample,
  active,
  onClick,
  farben,
}: {
  label: string
  /** Klasse für die Grösse des „A" im Knopf */
  sample: string
  active: boolean
  onClick: () => void
  farben: Farben
}) {
  return (
    <button
      type="button"
      onMouseDown={holdFocus}
      onClick={onClick}
      aria-label={`Textgrösse ${label}`}
      aria-pressed={active}
      title={label}
      className={`flex h-10 flex-1 items-end justify-center rounded-lg pb-2 leading-none transition ${
        active
          ? farben.aktiv
          : 'text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-700/60'
      }`}
    >
      <span className={`font-medium ${sample}`} aria-hidden="true">
        A
      </span>
    </button>
  )
}

function ColorDot({
  label,
  dotClass,
  active,
  onClick,
  farben,
}: {
  label: string
  dotClass: string
  active: boolean
  onClick: () => void
  farben: Farben
}) {
  return (
    <button
      type="button"
      onMouseDown={holdFocus}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid size-7 shrink-0 place-items-center rounded-full transition active:bg-slate-100 dark:active:bg-slate-700/60 ${
        active ? `ring-2 ring-offset-1 dark:ring-offset-slate-800 ${farben.ring}` : ''
      }`}
    >
      <span className={`size-4 rounded-full ${dotClass}`} aria-hidden="true" />
    </button>
  )
}

function ClearDot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={holdFocus}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-slate-400 transition active:bg-slate-100 dark:active:bg-slate-700/60"
    >
      <NoneIcon />
    </button>
  )
}

function MenuButton({
  onClick,
  wide = false,
  children,
}: {
  onClick: () => void
  wide?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={holdFocus}
      onClick={onClick}
      className={`flex min-h-10 items-center gap-2 rounded-lg px-2 text-left text-sm transition active:bg-slate-100 dark:active:bg-slate-700/60 ${
        wide ? 'w-full' : 'flex-1 justify-center'
      }`}
    >
      {children}
    </button>
  )
}

function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Zeichen                                                             */
/* ------------------------------------------------------------------ */

const ICON = 'size-4 shrink-0'

/** Ein „T" mit Serifen – das übliche Zeichen für „Text formatieren". */
function FormatIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7V4h16v3M9 20h6M12 4v16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6h11M9 12h11M9 18h11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="4.5" cy="6" r="1.4" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.4" fill="currentColor" />
    </svg>
  )
}

function IndentIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 5h18M11 10h10M11 14h10M3 19h18M3 9l4 3-4 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function OutdentIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 5h18M11 10h10M11 14h10M3 19h18M7 9l-4 3 4 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Ein „T", durchgestrichen – Formatierung weg, der Text bleibt. */
function ClearFormatIcon() {
  return (
    <svg className={`${ICON} text-slate-500`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7V4h12v3M10 4v16M8 20h4M15 14l6 6M21 14l-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Die Büroklammer – eine Datei anhängen. */
export function PaperclipIcon({ className = ICON }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m20.5 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Ein durchgestrichener Kreis – „keine Farbe". */
function NoneIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 6.5l11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
