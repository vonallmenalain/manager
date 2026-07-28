import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

/**
 * Eingabefeld mit Label, Fehler und Hinweis. text-base ist Absicht:
 * unter 16px zoomt mobiles Safari/Chrome beim Fokus automatisch hinein.
 */
export function Field({ label, error, hint, className = '', ...props }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition
          bg-white dark:bg-slate-900
          text-slate-900 dark:text-slate-100
          placeholder:text-slate-400
          focus:ring-2 focus:ring-brand-500/40
          ${
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-slate-300 focus:border-brand-500 dark:border-slate-700'
          } ${className}`}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
