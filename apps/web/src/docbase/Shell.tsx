import type { PublicUser } from '@manager/shared'
import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { CategorySheet } from '../components/CategorySheet'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { FolderIcon, LogoutIcon } from '../components/icons'
import { useLogout } from '../lib/session'

/**
 * Die Hülle der DocBase.
 *
 * Ohne Navigationsleiste am unteren Rand: Es gibt genau eine Liste und die
 * Ansicht eines Dokuments darin. Eine Leiste mit einem einzigen Eintrag wäre
 * eine Antwort auf eine Frage, die sich hier nicht stellt – und sie nähme dem
 * Handy die untersten sechzig Bildpunkte weg, auf denen sonst Treffer stehen.
 */
export function Shell({ user }: { user: PublicUser }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-teal-700 text-sm font-bold text-white">
              D
            </span>
            <span className="font-semibold">DocBase</span>
          </div>
          <Menu user={user} />
        </div>
        <ConnectionBanner />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Konto und Kategorien hinter dem Kreis mit dem Anfangsbuchstaben – wie im
 * Manager, nur ohne alles, was den Haushalt betrifft. Mitglieder anlegen und
 * der Zustand des Servers gehören dorthin, wo der Haushalt verwaltet wird.
 */
function Menu({ user }: { user: PublicUser }) {
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const logout = useLogout()

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <>
      <div
        ref={menuRef}
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
          aria-label="Konto"
          className="grid size-9 min-h-11 place-items-center"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: user.color }}
            aria-hidden="true"
          >
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
            </div>

            <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setCategories(true)
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition active:bg-black/5 dark:active:bg-white/10"
            >
              <FolderIcon className="size-4" />
              Kategorien
            </button>

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
        ) : null}
      </div>

      {categories ? (
        <CategorySheet
          bereich="docbase"
          isAdmin={user.isAdmin}
          onClose={() => setCategories(false)}
        />
      ) : null}
    </>
  )
}
