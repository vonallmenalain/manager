import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { eq, lt } from 'drizzle-orm'

import { db } from '../db/index.js'
import { sessions, users, type User } from '../db/schema.js'
import { env } from '../env.js'

export const SESSION_COOKIE = 'manager_session'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Verlängert die Sitzung, sobald weniger als ein Drittel der Laufzeit übrig ist.
 * So bleibt ein aktiv genutztes Handy dauerhaft angemeldet, ohne dass bei jedem
 * einzelnen Request in die Datenbank geschrieben wird.
 */
const RENEW_THRESHOLD = 1 / 3

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function expiryFromNow(): Date {
  return new Date(Date.now() + env.SESSION_DAYS * DAY_MS)
}

export interface CreatedSession {
  token: string
  expiresAt: Date
}

export async function createSession(userId: string, userAgent?: string): Promise<CreatedSession> {
  // 32 Byte Zufall: nicht erratbar, und als base64url kurz genug für ein Cookie.
  const token = randomBytes(32).toString('base64url')
  const expiresAt = expiryFromNow()

  await db.insert(sessions).values({
    id: randomUUID(),
    tokenHash: hashToken(token),
    userId,
    expiresAt: expiresAt.toISOString(),
    userAgent: userAgent?.slice(0, 300),
  })

  return { token, expiresAt }
}

export interface ValidatedSession {
  user: User
  /** Gesetzt, wenn der Aufrufer das Cookie mit neuem Ablaufdatum erneuern soll. */
  renewedUntil?: Date
}

export async function validateSession(token: string): Promise<ValidatedSession | null> {
  const tokenHash = hashToken(token)

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const expiresAt = new Date(row.session.expiresAt)
  if (expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id))
    return null
  }

  const totalMs = env.SESSION_DAYS * DAY_MS
  const remainingMs = expiresAt.getTime() - Date.now()

  if (remainingMs < totalMs * RENEW_THRESHOLD) {
    const renewedUntil = expiryFromNow()
    await db
      .update(sessions)
      .set({
        expiresAt: renewedUntil.toISOString(),
        lastSeenAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, row.session.id))
    return { user: row.user, renewedUntil }
  }

  return { user: row.user }
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

/** Meldet alle Geräte eines Nutzers ab – z.B. nach einer Passwortänderung. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

export async function deleteExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date().toISOString()))
  return result.changes
}
