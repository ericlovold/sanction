"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// Console shell sidebar. Active state is derived from the path, so pages no longer
// pass an `active` prop. AccountControl is rendered server-side and passed in via
// `account` so this client component never imports a server component.

type Item = { href: string; label: string; icon: ReactNode; badge?: number }

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0">
      <path d={d} />
    </svg>
  )
}

// Minimal inline icons (no icon-lib dependency).
const ICON = {
  overview: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z",
  keys: "M21 2l-2 2m-7.5 7.5a4.5 4.5 0 1 1-1.4-1.4L21 0M15 5l3 3",
  spend: "M3 3v18h18M7 14l3-3 3 3 5-6",
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
}

const items: Item[] = [
  { href: "/dashboard", label: "Overview", icon: <Icon d={ICON.overview} /> },
  { href: "/dashboard/keys", label: "API Keys", icon: <Icon d={ICON.keys} /> },
  { href: "/dashboard/spend", label: "Spend", icon: <Icon d={ICON.spend} /> },
  { href: "/dashboard/approvals", label: "Approvals", icon: <Icon d={ICON.approvals} /> },
]

function useActive() {
  const pathname = usePathname()
  return (href: string) => (href === "/dashboard" ? pathname === href : pathname.startsWith(href))
}

function NavLink({ item, pending, onNavigate }: { item: Item; pending: number; onNavigate?: () => void }) {
  const isActive = useActive()(item.href)
  const showBadge = item.href === "/dashboard/approvals" && pending > 0
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        isActive ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      <span className={isActive ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}>{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {showBadge && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">{pending}</span>
      )}
    </Link>
  )
}

export function DashboardSidebar({
  view,
  pendingCount,
  account,
}: {
  view: { name: string; isSession: boolean }
  pendingCount: number
  account: ReactNode
}) {
  return (
    <>
      {/* Desktop: persistent left rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 px-3 py-5 md:flex">
        <div className="px-2">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight text-zinc-100 hover:text-zinc-300">
            Sanction
          </Link>
          <p className="mt-0.5 truncate text-xs text-zinc-600">
            {view.name}
            {!view.isSession && <span className="ml-1.5 rounded border border-zinc-800 px-1 py-px text-[10px] text-zinc-500">demo</span>}
          </p>
        </div>
        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {items.map((it) => (
            <NavLink key={it.href} item={it} pending={pendingCount} />
          ))}
        </nav>
        <div className="border-t border-zinc-900 px-2 pt-3">{account}</div>
      </aside>

      {/* Mobile: top bar */}
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-zinc-900 bg-zinc-950/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-display text-base font-semibold tracking-tight text-zinc-100">Sanction</Link>
          {account}
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto">
          {items.map((it) => (
            <NavLink key={it.href} item={it} pending={pendingCount} />
          ))}
        </nav>
      </header>
    </>
  )
}
