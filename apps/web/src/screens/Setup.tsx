import { type FormEvent, useState } from 'react'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { ApiRequestError } from '../lib/api'
import { useSetup } from '../lib/session'
import { Logo } from './Login'

/**
 * Wird nur angezeigt, solange noch kein einziges Konto existiert. Danach ist
 * der zugehörige Endpunkt dauerhaft gesperrt – auch wenn das Token gesetzt bleibt.
 */
export function Setup() {
  const setup = useSetup()
  const [form, setForm] = useState({ name: '', email: '', password: '', setupToken: '' })

  const error = setup.error instanceof ApiRequestError ? setup.error : null

  function update(key: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setup.mutate(form)
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-4 text-2xl font-bold">Ersteinrichtung</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Lege das erste Konto an. Das zweite kannst du danach direkt in der App hinzufügen.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field
            label="Name"
            value={form.name}
            onChange={update('name')}
            autoComplete="name"
            required
            error={error?.fields.name}
          />
          <Field
            label="E-Mail"
            type="email"
            value={form.email}
            onChange={update('email')}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            error={error?.fields.email}
          />
          <Field
            label="Passwort"
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            required
            hint="Mindestens 10 Zeichen."
            error={error?.fields.password}
          />
          <Field
            label="Einrichtungs-Token"
            value={form.setupToken}
            onChange={update('setupToken')}
            autoCapitalize="none"
            required
            hint="Der Wert von SETUP_TOKEN aus der Container-Konfiguration."
            error={error?.fields.setupToken}
          />

          {error && Object.keys(error.fields).length === 0 ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              {error.message}
            </p>
          ) : null}

          <Button type="submit" loading={setup.isPending}>
            Konto anlegen
          </Button>
        </form>
      </div>
    </div>
  )
}
