"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// Console shell sidebar. Active state is derived from the path, so pages no longer
// pass an `active` prop. AccountControl is rendered server-side and passed in via
// `account` so this client component never imports a server component.

type Item = { href: string; label: string; icon: ReactNode }

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
  agents: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  pools: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  spend: "M3 3v18h18M7 14l3-3 3 3 5-6",
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  grants: "M12 3l7 4v5c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4ZM9 12l2 2 4-4",
}

// Ordered by operator job priority: resolve approvals, check burn, manage
// seats — browsing (Overview/Pools/Grants) trails. On the mobile strip this
// keeps Approvals first and always on-screen.
const items: Item[] = [
  { href: "/dashboard/approvals", label: "Approvals", icon: <Icon d={ICON.approvals} /> },
  { href: "/dashboard/spend", label: "Spend", icon: <Icon d={ICON.spend} /> },
  { href: "/dashboard/agents", label: "Agents", icon: <Icon d={ICON.agents} /> },
  { href: "/dashboard", label: "Overview", icon: <Icon d={ICON.overview} /> },
  { href: "/dashboard/pools", label: "Pools", icon: <Icon d={ICON.pools} /> },
  { href: "/dashboard/grants", label: "Grants", icon: <Icon d={ICON.grants} /> },
]

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href)
}

function NavLink({ item, active, pending, onNavigate }: { item: Item; active: boolean; pending: number; onNavigate?: () => void }) {
  const showBadge = item.href === "/dashboard/approvals" && pending > 0
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      <span className={active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}>{item.icon}</span>
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
  const pathname = usePathname()
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
            <NavLink key={it.href} item={it} active={isActive(pathname, it.href)} pending={pendingCount} />
          ))}
        </nav>
        <div className="border-t border-zinc-900 px-2 pt-3">{account}</div>
      </aside>

      {/* Mobile: top bar with a horizontally scrollable nav */}
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-zinc-900 bg-zinc-950/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-display text-base font-semibold tracking-tight text-zinc-100">Sanction</Link>
          {account}
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto">
          {items.map((it) => (
            <NavLink key={it.href} item={it} active={isActive(pathname, it.href)} pending={pendingCount} />
          ))}
        </nav>
      </header>
    </>
  )
}
