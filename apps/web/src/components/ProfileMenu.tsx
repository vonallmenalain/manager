import type { PublicUser } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { api, ApiRequestError } from '../lib/api'
import { useLogout } from '../lib/session'
import { Button } from './Button'
import { Field } from './Field'
import { LogoutIcon, PlusIcon } from './icons'
import { Modal, ModalCloseButton } from './Modal'

/**
 * Das eigene Konto, hinter dem Kreis mit dem Anfangsbuchstaben.
 *
 * Vorher stand neben dem Namen „Angemeldet" – eine Zeile, die nichts sagt,
 * was man nicht schon sieht – und daneben ein Knopf zum Abmelden. Abmelden
 * ist aber nichts, was man täglich tut und immer im Blick haben muss; es
 * gehört zum Konto, und das Konto steckt hinter dem Kreis.
 *
 * Was der Verwalter zusätzlich sieht, steht ebenfalls hier: ob der Server
 * erreichbar ist, und der Weg, ein Mitglied anzulegen. Beides ist Betrieb
 * und nicht Haushalt – auf dem Startbildschirm hat es nichts verloren.
 */
export function ProfileMenu({ user }: { user: PublicUser }) {
  const [open, setOpen] = useState(false)
  const [household, setHousehold] = useState(false)
  const logout = useLogout()

  return (
    <>
      <div
        className="relative"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <button
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex min-h-11 items-center gap-3 rounded-full pr-2 text-left"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: user.color }}
            aria-hidden="true"
          >
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-semibold">{user.name}</span>
        </button>

        {open ? (
          <>
            {/* Fängt den Griff daneben ab – sonst bliebe das Menü offen. */}
            <button
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Menü schliessen"
            />
            <div
              role="menu"
              className="absolute left-0 top-12 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
              </div>

              {user.isAdmin ? (
                <>
                  <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                  <BackendState />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setOpen(false)
                      setHousehold(true)
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition active:bg-black/5 dark:active:bg-white/10"
                  >
                    <PlusIcon className="size-4" />
                    Mitglied hinzufügen
                  </button>
                </>
              ) : null}

              <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
              <button
                role="menuitem"
                onClick={() => logout.mutate()}
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition active:bg-black/5 dark:active:bg-white/10"
              >
                <LogoutIcon className="size-4" />
                Abmelden
              </button>
            </div>
          </>
        ) : null}
      </div>

      {household ? <HouseholdSheet onClose={() => setHousehold(false)} /> : null}
    </>
  )
}

/**
 * Ob der Server antwortet. Ohne Versionsnummer: Die beantwortet keine Frage,
 * die man sich am Handy stellt – wichtig ist, ob es gerade an einem selbst
 * liegt oder nicht.
 */
function BackendState() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 })

  return (
    <p className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">Verbindung</span>
      <span className="flex items-center gap-2 font-medium">
        <span
          className={`size-2 rounded-full ${
            health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-slate-300'
          }`}
          aria-hidden="true"
        />
        {health.isSuccess ? 'erreichbar' : health.isError ? 'nicht erreichbar' : 'prüfe …'}
      </span>
    </p>
  )
}

/** Der Haushalt: wer dazugehört, und der Weg, jemanden aufzunehmen. */
function HouseholdSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers })
  const [form, setForm] = useState({ name: '', email: '', password: '' })

  const createUser = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setForm({ name: '', email: '', password: '' })
    },
  })

  const error = createUser.error instanceof ApiRequestError ? createUser.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    createUser.mutate(form)
  }

  return (
    <Modal
      onClose={onClose}
      label="Haushalt"
      header={
        <>
          <span className="text-sm font-semibold">Haushalt</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      <ul className="space-y-2">
        {users.data?.users.map((member) => (
          <li key={member.id} className="flex items-center gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: member.color }}
              aria-hidden="true"
            >
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{member.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{member.email}</p>
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={handleSubmit}
        className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
        noValidate
      >
        <p className="text-sm font-medium">Mitglied hinzufügen</p>
        <Field
          label="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
          error={error?.fields.name}
        />
        <Field
          label="E-Mail"
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          inputMode="email"
          autoCapitalize="none"
          required
          error={error?.fields.email}
        />
        <Field
          label="Passwort"
          type="password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          autoComplete="new-password"
          required
          hint="Mindestens 10 Zeichen. Kann später selbst geändert werden."
          error={error?.fields.password}
        />
        {error && Object.keys(error.fields).length === 0 ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        ) : null}
        <Button type="submit" loading={createUser.isPending}>
          Hinzufügen
        </Button>
      </form>
    </Modal>
  )
}
