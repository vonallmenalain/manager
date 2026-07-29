import type { PublicUser } from '@manager/shared'
import { NavLink, Outlet } from 'react-router-dom'

import { ConnectionBanner } from './ConnectionBanner'
import { CartIcon, CoinIcon, DocumentIcon, HomeIcon, NoteIcon } from './icons'
import { ProfileMenu } from './ProfileMenu'

const TABS = [
  { to: '/', label: 'Start', Icon: HomeIcon, end: true },
  { to: '/dokumente', label: 'Dokumente', Icon: DocumentIcon, end: false },
  { to: '/einkauf', label: 'Einkauf', Icon: CartIcon, end: false },
  { to: '/notizen', label: 'Notizen', Icon: NoteIcon, end: false },
  { to: '/finanzen', label: 'Finanzen', Icon: CoinIcon, end: false },
] as const

export function AppShell({ user }: { user: PublicUser }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <ProfileMenu user={user} />
        </div>
        <ConnectionBanner />
      </header>

      {/* pb-24 hält den Inhalt über der Navigationsleiste frei. */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>

      {/* data-navigationsleiste: Blendet die Leiste aus, solange eine
          bildschirmfüllende Fläche offen ist (siehe index.css). */}
      <nav
        data-navigationsleiste
        className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          {TABS.map(({ to, label, Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition ${
                    isActive
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={isActive ? 'size-6' : 'size-6 opacity-80'} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
