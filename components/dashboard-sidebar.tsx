"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { ThemeToggle } from "@/components/theme-toggle"

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
  outcomes: "M20 6 9 17l-5-5M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  policy: "M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4Z",
  credentials: "M5 11V7a7 7 0 0 1 14 0v4M5 11h14v9H5zM12 15v2",
  tokens: "M4 7h16v10H4zM8 7V5h8v2M9 12h6",
  audit: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h6M9 9h1",
}

// Ordered by operator job priority: resolve approvals, check burn, manage
// seats — browsing (Overview/Pools) trails. On the mobile strip this
// keeps Approvals first and always on-screen.
const items: Item[] = [
  { href: "/dashboard/approvals", label: "Approvals", icon: <Icon d={ICON.approvals} /> },
  { href: "/dashboard/agents", label: "Seats", icon: <Icon d={ICON.agents} /> },
  { href: "/dashboard/credentials", label: "Credentials", icon: <Icon d={ICON.credentials} /> },
  { href: "/dashboard/tokens", label: "Execution", icon: <Icon d={ICON.tokens} /> },
  { href: "/dashboard/policy", label: "Policy", icon: <Icon d={ICON.policy} /> },
  { href: "/dashboard/spend", label: "Spend", icon: <Icon d={ICON.spend} /> },
  { href: "/dashboard/outcomes", label: "Outcomes", icon: <Icon d={ICON.outcomes} /> },
  { href: "/dashboard/audit", label: "Audit", icon: <Icon d={ICON.audit} /> },
  { href: "/dashboard", label: "Overview", icon: <Icon d={ICON.overview} /> },
  { href: "/dashboard/pools", label: "Pools", icon: <Icon d={ICON.pools} /> },
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
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className={active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}>{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {showBadge && (
        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{pending}</span>
      )}
    </Link>
  )
}

export function DashboardSidebar({
  view,
  pendingCount,
  hasPools = true,
  account,
}: {
  view: { name: string; isSession: boolean }
  pendingCount: number
  // Pools is conceptual overhead for a single-wallet operator — hidden until
  // the wallet actually has children. The page stays reachable by URL.
  hasPools?: boolean
  account: ReactNode
}) {
  const pathname = usePathname()
  const visible = hasPools ? items : items.filter((it) => it.href !== "/dashboard/pools")
  return (
    <>
      {/* Desktop: persistent left rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex">
        <div className="px-2">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight text-foreground hover:text-primary">
            Sanction
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {view.name}
            {!view.isSession && <span className="ml-1.5 rounded border border-border px-1 py-px text-[10px] text-muted-foreground">demo</span>}
          </p>
        </div>
        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {visible.map((it) => (
            <NavLink key={it.href} item={it} active={isActive(pathname, it.href)} pending={pendingCount} />
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-sidebar-border px-2 pt-3">
          {account}
          <ThemeToggle collapsed />
        </div>
      </aside>

      {/* Mobile: top bar with a horizontally scrollable nav */}
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-display text-base font-semibold tracking-tight text-foreground">Sanction</Link>
          <div className="flex items-center gap-1">
            <ThemeToggle collapsed />
            {account}
          </div>
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto">
          {visible.map((it) => (
            <NavLink key={it.href} item={it} active={isActive(pathname, it.href)} pending={pendingCount} />
          ))}
        </nav>
      </header>
    </>
  )
}
