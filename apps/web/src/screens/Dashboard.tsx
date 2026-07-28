import type { PublicUser } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { api, ApiRequestError } from '../lib/api'

export function Dashboard({ user }: { user: PublicUser }) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 })

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">{greeting()}, {user.name.split(' ')[0]}.</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Das Fundament steht. Die Bereiche unten füllen wir Schritt für Schritt.
        </p>
      </section>

      <HouseholdCard />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Verbindung</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500 dark:text-slate-400">Backend</dt>
            <dd className="flex items-center gap-2 font-medium">
              <span
                className={`size-2 rounded-full ${
                  health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-slate-300'
                }`}
                aria-hidden="true"
              />
              {health.isSuccess ? 'erreichbar' : health.isError ? 'nicht erreichbar' : 'prüfe …'}
            </dd>
          </div>
          {health.data ? (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Version</dt>
              <dd className="font-mono text-xs">{health.data.version}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <Roadmap />
    </div>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Gute Nacht'
  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Hallo'
  return 'Guten Abend'
}

function HouseholdCard() {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })

  const createUser = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '' })
    },
  })

  const error = createUser.error instanceof ApiRequestError ? createUser.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    createUser.mutate(form)
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Haushalt</h2>

      <ul className="mt-3 space-y-2">
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

      {showForm ? (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" noValidate>
          <Field
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            error={error?.fields.name}
          />
          <Field
            label="E-Mail"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            inputMode="email"
            autoCapitalize="none"
            required
            error={error?.fields.email}
          />
          <Field
            label="Passwort"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            required
            hint="Mindestens 10 Zeichen. Kann später selbst geändert werden."
            error={error?.fields.password}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
              Abbrechen
            </Button>
            <Button type="submit" loading={createUser.isPending}>
              Hinzufügen
            </Button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="mt-3 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          + Mitglied hinzufügen
        </button>
      )}
    </section>
  )
}

const ROADMAP = [
  { stage: 1, title: 'Dokumente', detail: 'Upload, Kategorien, Status, Zuweisung, Suche' },
  { stage: 2, title: 'Mobil', detail: 'Teilen-Menü, Kamera-Scan, Offline' },
  { stage: 3, title: 'Texterkennung', detail: 'OCR und Volltextsuche' },
  { stage: 4, title: 'Einkauf & Notizen', detail: 'Gemeinsame Listen, offline nutzbar' },
  { stage: 5, title: 'Finanzen', detail: 'Einkommen, Steuern, Zehnten, Fastopfer' },
] as const

function Roadmap() {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Als Nächstes</h2>
      <ol className="mt-3 space-y-3">
        {ROADMAP.map((item) => (
          <li key={item.stage} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {item.stage}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
