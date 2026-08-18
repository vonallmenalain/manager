import { appAktualisieren, useUpdateZustand } from '../lib/appUpdate'

/**
 * Der Hinweis am unteren Rand, wenn eine neue Fassung bereitliegt.
 *
 * Er sitzt über der Navigationsleiste und nicht darüber am Kopf: Dort unten
 * ist der Daumen ohnehin, und der Hinweis verdeckt keinen Inhalt, den man
 * gerade liest. Wer ihn stehen lässt, arbeitet ungestört weiter – die neue
 * Fassung wartet, bis es passt.
 *
 * `data-navigationsleiste` trägt er mit Absicht: Solange eine
 * bildschirmfüllende Fläche offen ist – der Scanner etwa –, verschwindet er
 * mit ihr zusammen (siehe index.css).
 */
export function UpdateBanner() {
  const { bereit, laeuft } = useUpdateZustand()
  if (!bereit) return null

  return (
    <div
      data-navigationsleiste
      role="status"
      // Genau über der Navigationsleiste: Die ist 3.5rem hoch und trägt den
      // sicheren Bereich des Geräts – beides muss der Abstand mitnehmen.
      className="pointer-events-none fixed inset-x-0 z-20 px-3 pb-2"
      style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-brand-800 px-4 py-3 text-white shadow-lg">
        <p className="min-w-0 flex-1 text-sm font-semibold">Neue Version verfügbar</p>
        <button
          onClick={() => void appAktualisieren()}
          disabled={laeuft}
          className="min-h-11 shrink-0 rounded-xl bg-white px-4 text-sm font-semibold text-brand-800 transition active:bg-white/80 disabled:opacity-70"
        >
          {laeuft ? 'Wird geladen …' : 'Aktualisieren'}
        </button>
      </div>
    </div>
  )
}
