/**
 * Die Geltungsbereiche der beiden Apps – an einer Stelle, weil sie
 * voneinander abhängen.
 *
 * Manager und DocBase liegen auf derselben Adresse und sind trotzdem zwei
 * installierbare Apps. Das geht nur, solange sich ihre Bereiche **nicht
 * überschneiden**. Lag der Manager auf `/`, umfasste sein Bereich `/docbase/`
 * gleich mit: Android registriert eine installierte PWA für ihren gesamten
 * Bereich, hielt die DocBase deshalb für dieselbe App und bot statt der
 * Installation nur „Diese App wurde bereits installiert" an.
 *
 * Beide Werte stehen im jeweiligen Manifest, in der Adresse des Teilen-Ziels
 * und in den Weiterleitungen von Netlify. Stünden sie an jeder dieser Stellen
 * für sich, liefen sie irgendwann auseinander – und der Fehler zeigte sich
 * erst auf dem Handy, beim Installieren, ohne Meldung im Build.
 */

/** Der Manager. Mit Schrägstrich am Ende, wie es das Manifest verlangt. */
export const MANAGER_SCOPE = '/app/'

/** Die DocBase. */
export const DOCBASE_SCOPE = '/docbase/'

/** Dieselben Adressen ohne Schrägstrich – so will sie der Router. */
export const MANAGER_BASENAME = MANAGER_SCOPE.slice(0, -1)
export const DOCBASE_BASENAME = DOCBASE_SCOPE.slice(0, -1)

/**
 * Liegt einer der beiden Bereiche im anderen?
 *
 * Genau das darf nie zutreffen; die Prüfung steht in `appScopes.test.ts`.
 */
export function scopesUeberschneidenSich(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a)
}
