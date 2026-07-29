import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useFullScreenOverlay } from '../lib/overlay'

/**
 * Ein Fenster über dem Bildschirm, kein eigener Bildschirm.
 *
 * Es ist so hoch, wie sein Inhalt es braucht, und wächst mit ihm bis kurz vor
 * den Bildschirmrand – erst dann bekommt der Inhalt eine Bildlaufleiste. Eine
 * kurze Eingabe ergibt also ein kleines Fenster, eine lange nutzt oben wie
 * unten fast alles, was da ist. Der schmale Rand bleibt mit Absicht: Er zeigt,
 * dass darunter noch die Seite liegt, und gibt eine Fläche zum Schliessen.
 *
 * Hängt über ein Portal am <body>: Als Kind der Seite, aus der es geöffnet
 * wurde, teilte es sich den Stapel mit der Navigationsleiste am unteren Rand –
 * und die schob sich auf dem Handy davor.
 */
export function Modal({
  onClose,
  label,
  className = 'bg-white dark:bg-slate-950',
  header,
  footer,
  children,
}: {
  onClose: () => void
  /** Für die Vorlesehilfe, wenn kein sichtbarer Titel im Kopf steht. */
  label: string
  /** Färbung des Fensters – die Notizen nutzen dafür ihre Farbe. */
  className?: string
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  useFullScreenOverlay()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/50 p-3" onClick={onClose}>
      <div
        // Der Klick im Fenster darf nicht bis zum Hintergrund durchfallen,
        // sonst schlösse jeder Griff nach einem Feld das Fenster.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // dvh statt vh: Auf dem Handy zählt die sichtbare Höhe, nicht die mit
        // eingeblendeter Adressleiste gerechnete – sonst stünde der Fuss des
        // Fensters unter dem Bildschirmrand.
        className={`flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-2xl border shadow-xl ${className}`}
      >
        {header ? (
          <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
            {header}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer ? (
          <div className="border-t border-black/5 px-4 py-3 dark:border-white/10">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/** Der Schliessen-Knopf, wie ihn jedes dieser Fenster oben rechts trägt. */
export function ModalCloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid size-11 min-h-11 place-items-center rounded-full text-slate-500 transition active:bg-black/5 dark:active:bg-white/10"
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  )
}
