import { type FormEvent, useState } from 'react'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { ApiRequestError } from '../lib/api'
import { useLogin } from '../lib/session'

/**
 * Anmeldung – für beide Apps dieselbe.
 *
 * Die DocBase ist eine eigene App auf dem Startbildschirm, aber kein zweites
 * Konto: Es ist derselbe Haushalt, dieselbe Sitzung, dasselbe Cookie. Nur der
 * Name über dem Feld wechselt, damit man weiss, wo man gerade steht.
 */
export function Login({
  titel = 'Manager',
  untertitel = 'Unser Haushalt, an einem Ort.',
  zeichen = 'M',
}: {
  titel?: string
  untertitel?: string
  zeichen?: string
} = {}) {
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const error = login.error instanceof ApiRequestError ? login.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    login.mutate({ email, password })
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo zeichen={zeichen} />
          <h1 className="mt-4 text-2xl font-bold">{titel}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{untertitel}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field
            label="E-Mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            error={error?.fields.email}
          />
          <Field
            label="Passwort"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            error={error?.fields.password}
          />

          {error && Object.keys(error.fields).length === 0 ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              {error.message}
            </p>
          ) : null}

          <Button type="submit" loading={login.isPending}>
            Anmelden
          </Button>
        </form>
      </div>
    </div>
  )
}

export function Logo({ zeichen = 'M' }: { zeichen?: string }) {
  return (
    <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-800 text-3xl font-bold text-white">
      {zeichen}
    </div>
  )
}
