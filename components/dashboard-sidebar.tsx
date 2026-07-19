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
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  policy: "M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4Z",
  credentials: "M5 11V7a7 7 0 0 1 14 0v4M5 11h14v9H5zM12 15v2",
  audit: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h6M9 9h1",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6",
}

// Consolidated nav (2026-07-16): 9 items, one home per job. Overview leads
// (the org pulse), Approvals right behind it (the #1 operator job, badge
// always near the top of the mobile strip). Former top-level pages live as
// sections now: API Keys → Team & access (mgmt key) + Seats (agent keys),
// Execution → Seats, Observe → Pools, Outcomes → Spend — each old URL
// redirects to its new home.
const items: Item[] = [
  { href: "/dashboard", label: "Overview", icon: <Icon d={ICON.overview} /> },
  { href: "/dashboard/approvals", label: "Approvals", icon: <Icon d={ICON.approvals} /> },
  { href: "/dashboard/agents", label: "Seats", icon: <Icon d={ICON.agents} /> },
  { href: "/dashboard/pools", label: "Pools", icon: <Icon d={ICON.pools} /> },
  { href: "/dashboard/policy", label: "Policy", icon: <Icon d={ICON.policy} /> },
  { href: "/dashboard/spend", label: "Spend", icon: <Icon d={ICON.spend} /> },
  { href: "/dashboard/audit", label: "Audit", icon: <Icon d={ICON.audit} /> },
  { href: "/dashboard/providers", label: "Providers", icon: <Icon d={ICON.spend} /> },
  { href: "/dashboard/credentials", label: "Credentials", icon: <Icon d={ICON.credentials} /> },
  { href: "/dashboard/team", label: "Team & access", icon: <Icon d={ICON.team} /> },
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
      data-tour={item.href.replace("/dashboard/", "nav-").replace("/dashboard", "nav-overview")}
      className={`group flex items-center gap-3 border-l-2 py-2 pl-3 pr-3 text-sm transition-colors ${
        active
          ? "border-sidebar-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "border-transparent text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      }`}
    >
      <span className={active ? "text-sidebar-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"}>{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {showBadge && (
        <span className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[oklch(0.82_0.11_85)]">{pending}</span>
      )}
    </Link>
  )
}

export function DashboardSidebar({
  view,
  pendingCount,
  hasPools = true,
  account,
  switcher,
}: {
  view: { name: string; isSession: boolean }
  pendingCount: number
  // Pools is conceptual overhead for a single-wallet operator — hidden until
  // the wallet actually has children. The page stays reachable by URL.
  hasPools?: boolean
  account: ReactNode
  // WALLET-MEMBERS part 2: rendered instead of the static name line when the
  // session can act as more than one wallet.
  switcher?: ReactNode
}) {
  const pathname = usePathname()
  const visible = hasPools ? items : items.filter((it) => it.href !== "/dashboard/pools")
  return (
    <>
      {/* Desktop: the deep-pine control rail framing the light workpaper */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-0 text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-sidebar-primary shadow-[0_0_6px_var(--sidebar-primary)]" />
            <span className="font-display text-[13px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground">Sanction</span>
          </Link>
          {switcher ?? (
            <p className="mt-2 truncate font-mono text-[11px] text-sidebar-foreground/45">
              {view.name}
              {!view.isSession && <span className="ml-1.5 rounded-sm border border-sidebar-border px-1 py-px text-[9px]">demo</span>}
            </p>
          )}
        </div>
        <nav className="flex flex-1 flex-col py-2">
          {visible.map((it) => (
            <NavLink key={it.href} item={it} active={isActive(pathname, it.href)} pending={pendingCount} />
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-sidebar-border px-3 py-3">
          <span className="flex items-center gap-1.5 font-display text-[8.5px] uppercase tracking-[0.1em] text-[oklch(0.78_0.11_85)]">
            <span className="size-1.5 rounded-full bg-[oklch(0.78_0.11_85)]" /> Signed ledger
          </span>
          <div className="flex items-center gap-1 text-sidebar-foreground">{account}<ThemeToggle collapsed /></div>
        </div>
      </aside>

      {/* Mobile: top bar with a horizontally scrollable nav */}
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-sidebar-border bg-sidebar px-4 py-3 text-sidebar-foreground backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-sidebar-primary" />
            <span className="font-display text-[13px] font-semibold uppercase tracking-[0.16em]">Sanction</span>
          </Link>
          <div className="flex items-center gap-1">{account}<ThemeToggle collapsed /></div>
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
