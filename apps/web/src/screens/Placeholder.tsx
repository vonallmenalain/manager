import type { ReactNode } from 'react'

interface PlaceholderProps {
  title: string
  stage: number
  description: string
  icon: ReactNode
}

/**
 * Steht in den Tabs, die noch nicht gebaut sind. Bewusst konkret statt
 * 'coming soon': Wer die App öffnet, soll sehen was kommt und wann.
 */
export function Placeholder({ title, stage, description, icon }: PlaceholderProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-600">
        {icon}
      </div>
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 max-w-xs text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <span className="mt-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        Etappe {stage}
      </span>
    </div>
  )
}
