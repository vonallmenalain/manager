/**
 * Wird beim Docker-Build über die Build-Arg APP_VERSION mit dem Git-SHA
 * gefüllt. Damit lässt sich in /api/health ablesen, welcher Stand gerade
 * auf dem NAS läuft – die einfachste Kontrolle, ob ein Deploy angekommen ist.
 */
export const APP_VERSION = process.env.APP_VERSION ?? 'dev'
