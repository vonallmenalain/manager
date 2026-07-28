import { randomUUID } from 'node:crypto'

import type { PublicUser } from '@manager/shared'
import { sql } from 'drizzle-orm'

import { hashPassword } from '../auth/password.js'
import { db } from '../db/index.js'
import { users, type User } from '../db/schema.js'

/** Kräftige, gut unterscheidbare Farben – auch bei Sonnenlicht auf dem Handy. */
const AVATAR_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'] as const

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    color: user.color,
    createdAt: user.createdAt,
  }
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)` }).from(users)
  return rows[0]?.count ?? 0
}

export interface CreateUserInput {
  name: string
  email: string
  password: string
}

export async function createUser({ name, email, password }: CreateUserInput): Promise<User> {
  const existingCount = await countUsers()
  const created = await db
    .insert(users)
    .values({
      id: randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password),
      color: AVATAR_COLORS[existingCount % AVATAR_COLORS.length],
    })
    .returning()

  const user = created[0]
  if (!user) throw new Error('Nutzer konnte nicht angelegt werden')
  return user
}
