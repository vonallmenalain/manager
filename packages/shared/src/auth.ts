import { z } from 'zod'

/**
 * Mindestlänge 10 statt der üblichen 8: Die Sitzung hält 90 Tage, das Passwort
 * wird also selten getippt. Länge kostet hier fast nichts und bringt viel.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Passwort muss mindestens 10 Zeichen lang sein')
  .max(200, 'Passwort ist zu lang')

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse angeben'),
  password: z.string().min(1, 'Passwort fehlt'),
})

export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Aktuelles Passwort fehlt'),
  newPassword: passwordSchema,
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80, 'Name ist zu lang'),
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse angeben'),
  password: passwordSchema,
})

export type CreateUserInput = z.infer<typeof createUserSchema>

/** Ersteinrichtung: wie createUser, zusätzlich abgesichert mit dem SETUP_TOKEN. */
export const setupSchema = createUserSchema.extend({
  setupToken: z.string().min(1, 'Einrichtungs-Token fehlt'),
})

export type SetupInput = z.infer<typeof setupSchema>

/**
 * Der Haushalt hat seine Verwalter, und das sind diese Konten.
 *
 * Bewusst eine kurze Liste von Adressen und keine Rollentabelle: Es sind die
 * beiden, die die App betreiben, und das ändert sich nicht im Wochentakt. Eine
 * Tabelle mit Rollen, Rechten und einer Oberfläche zum Vergeben wäre Verwaltung
 * für eine Entscheidung, die längst getroffen ist – kommt jemand dazu, ist es
 * eine Zeile hier.
 *
 * Verwalter heisst nicht „darf mehr sehen" – Dokumente, Notizen und Finanzen
 * gehören dem Haushalt gemeinsam. Es heisst: darf den Haushalt selbst ändern
 * (Mitglieder anlegen, Kategorien umbenennen und löschen) und sieht, ob der
 * Server erreichbar ist.
 */
export const ADMIN_EMAILS = ['alain.sc2@gmail.com', 'annina.vonallmen@gmail.com'] as const

export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return ADMIN_EMAILS.some((admin) => admin === normalized)
}

/** Öffentliches Nutzerprofil – enthält bewusst keinen Passwort-Hash. */
export const publicUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  color: z.string(),
  createdAt: z.string(),
  /**
   * Wird vom Server aus der Adresse abgeleitet und mitgeliefert. So steht die
   * Regel an einer Stelle: Das Frontend blendet ein, was der Server ohnehin
   * durchlässt, statt dieselbe Bedingung ein zweites Mal zu kennen.
   */
  isAdmin: z.boolean(),
})

export type PublicUser = z.infer<typeof publicUserSchema>
