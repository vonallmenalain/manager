import { formatAmount, monthName, type PublicUser } from '@manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { api, ApiRequestError } from '../lib/api'
import { useDocuments } from '../lib/documents'

export function Dashboard({ user }: { user: PublicUser }) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 })

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">{greeting()}, {user.name.split(' ')[0]}.</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Was heute offen ist, steht gleich unten.
        </p>
      </section>

      <PendingCard />

      <TithingCard />

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

/**
 * Beantwortet die Frage, für die man die App am ehesten öffnet: Was ist
 * noch offen? Fälligkeiten stehen zuerst, danach der Rest.
 */
function PendingCard() {
  const pending = useDocuments({ pending: true })
  const documents = pending.data?.documents ?? []

  const today = new Date().toISOString().slice(0, 10)
  const due = documents
    .filter((document) => document.dueDate !== null)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))

  if (pending.isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Pendent</h2>
        <Link to="/dokumente" className="text-sm font-medium text-brand-700 dark:text-brand-300">
          Alle ansehen
        </Link>
      </div>

      {documents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Nichts offen. Angenehm.
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-bold">{pending.data?.total ?? documents.length}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {(pending.data?.total ?? 0) === 1 ? 'Dokument wartet' : 'Dokumente warten'}
          </p>

          {due.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
              {due.slice(0, 3).map((document) => (
                <li key={document.id}>
                  <Link
                    to={`/dokumente/${document.id}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{document.title}</span>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        (document.dueDate ?? '') < today
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {(document.dueDate ?? '') < today ? 'überfällig' : `bis ${document.dueDate}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
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

/**
 * Der Zehnten-Stand des laufenden Jahres. Steht hier, weil man ihn sonst
 * nur beim Nachsehen bemerkt – und dann ist der Monat oft schon vorbei.
 */
function TithingCard() {
  const year = new Date().getFullYear()
  const finance = useQuery({
    queryKey: ['finanzen', year],
    queryFn: () => api.getFinanceYear(year),
  })

  if (finance.isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
  }
  if (!finance.data) return null

  const { figures } = finance.data

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Zehnter {year}</h2>
        <Link to="/finanzen" className="text-sm font-medium text-brand-700 dark:text-brand-300">
          Abrechnen
        </Link>
      </div>

      {figures.lastEnteredMonth === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Für {year} ist noch kein Einkommen erfasst.
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            CHF {formatAmount(figures.openTithingCents)}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {figures.openMonths.length === 0
              ? 'Alles Erfasste ist abgerechnet.'
              : `offen für ${figures.openMonths.map(monthName).join(', ')}`}
          </p>
          {figures.settledThroughMonth > 0 ? (
            <p className="mt-1 text-xs text-slate-400">
              Abgerechnet bis und mit {monthName(figures.settledThroughMonth)}.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
