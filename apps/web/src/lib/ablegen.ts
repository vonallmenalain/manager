import {
  DEFAULT_DOCUMENT_STATUS,
  titleFromFilename,
  type Bereich,
  type DocumentStatus,
  type ManagedDocument,
} from '@manager/shared'

import { api, ApiRequestError } from './api'
import type { TrayField } from '../components/PageTray'

/**
 * Eine Datei als Dokument ablegen – mit den Angaben, die vorher im Formular
 * standen. Gebraucht nach dem Teilen und beim Hochladen über „Datei wählen":
 * Beide Wege sollen dasselbe ablegen und dieselben Fehler gleich melden.
 */

/** Was vor dem Ablegen gewählt wird. */
export interface AblageAngaben {
  titel: string
  categoryId: string | null
  assignedTo: string | null
  status: DocumentStatus
  /** JJJJ-MM-TT oder leer */
  faellig: string
  notiz: string
}

/** Ohne Eingabe: unsortiert, für beide, pendent, ohne Fälligkeit und Notiz. */
export const OHNE_ANGABEN: Omit<AblageAngaben, 'titel'> = {
  categoryId: null,
  assignedTo: null,
  status: DEFAULT_DOCUMENT_STATUS,
  faellig: '',
  notiz: '',
}

/** So würde die Datei ohne Eingabe abgelegt – der Titel aus dem Dateinamen. */
export function standardAngaben(file: File): AblageAngaben {
  return { titel: titleFromFilename(file.name), ...OHNE_ANGABEN }
}

export type AblageErgebnis =
  /** `hinweis`: abgelegt, aber Fälligkeit oder Notiz fehlen noch. */
  | { art: 'abgelegt'; dokument: ManagedDocument; hinweis?: string }
  | { art: 'doppelt'; meldung: string; vorhanden?: ManagedDocument }
  | { art: 'fehler'; meldung: string }

export async function dokumentAblegen(
  file: File,
  angaben: AblageAngaben,
  {
    bereich,
    felder,
    faellig,
    trotzdem = false,
  }: {
    bereich: Bereich
    /** Welche Auswahlfelder gezeigt wurden – nur deren Werte gehen mit. */
    felder: readonly TrayField[]
    /** Ob „Fällig" gezeigt wurde – nur der Haushalt kennt Fälligkeiten. */
    faellig: boolean
    /** Auch ablegen, wenn dieselbe Datei schon in der Ablage liegt. */
    trotzdem?: boolean
  },
): Promise<AblageErgebnis> {
  let dokument: ManagedDocument
  try {
    const { document } = await api.uploadDocument(file, trotzdem, {
      bereich,
      title: angaben.titel.trim() || undefined,
      categoryId: felder.includes('kategorie') ? angaben.categoryId : undefined,
      assignedTo: felder.includes('zustaendig') ? angaben.assignedTo : undefined,
      status: felder.includes('status') ? angaben.status : undefined,
    })
    dokument = document
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 'duplicate') {
      const data = error.data as { existing?: ManagedDocument } | undefined
      return { art: 'doppelt', meldung: error.message, vorhanden: data?.existing }
    }
    return {
      art: 'fehler',
      meldung: error instanceof Error ? error.message : 'Ablegen fehlgeschlagen.',
    }
  }

  // Ab hier liegt das Dokument in der Ablage – was danach schiefgeht, darf es
  // nicht ein zweites Mal hochladen.
  //
  // Fälligkeit und Notiz nimmt das Hochladen nicht an; sie gehen gleich danach
  // mit, bevor jemand das Dokument zu sehen bekommt. Scheitert das, bleibt das
  // Dokument abgelegt, und das Ergebnis sagt, was fehlt.
  const bis = faellig && angaben.faellig ? angaben.faellig : undefined
  const notiz = angaben.notiz.trim() || undefined
  if (!bis && !notiz) return { art: 'abgelegt', dokument }

  try {
    await api.updateDocument(dokument.id, {
      ...(bis ? { dueDate: bis } : {}),
      ...(notiz ? { notes: notiz } : {}),
    })
    return { art: 'abgelegt', dokument }
  } catch {
    const fehlt =
      bis && notiz
        ? 'Fälligkeit und Notiz fehlen'
        : bis
          ? 'die Fälligkeit fehlt'
          : 'die Notiz fehlt'
    return {
      art: 'abgelegt',
      dokument,
      hinweis: `abgelegt, aber ${fehlt} – bitte im Dokument nachtragen.`,
    }
  }
}
