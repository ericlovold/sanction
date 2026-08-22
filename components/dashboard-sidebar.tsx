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
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  credentials: "M5 11V7a7 7 0 0 1 14 0v4M5 11h14v9H5zM12 15v2",
}

// Roster pass (2026-08-15): three surfaces. The tree is home. Approvals is
// the only job that is not an object property. Vault holds secrets, people,
// and the signed record. Old URLs stay reachable from the vault drawers.
const items: Item[] = [
  { href: "/dashboard", label: "Roster", icon: <Icon d={ICON.overview} /> },
  { href: "/dashboard/approvals", label: "Approvals", icon: <Icon d={ICON.approvals} /> },
  { href: "/dashboard/vault", label: "Vault", icon: <Icon d={ICON.credentials} /> },
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
  hasPools: _hasPools = true,
  account,
  switcher,
}: {
  view: { name: string; isSession: boolean }
  pendingCount: number
  // Kept so the layout does not change. Pools are group cards on the roster.
  hasPools?: boolean
  account: ReactNode
  // WALLET-MEMBERS part 2: rendered instead of the static name line when the
  // session can act as more than one wallet.
  switcher?: ReactNode
}) {
  const pathname = usePathname()
  const visible = items
  return (
    <>
      {/* Desktop: the deep-pine control rail framing the light workpaper */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-0 text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-sidebar-primary shadow-[0_0_6px_var(--sidebar-primary)]" />
            <img src="/brand/sanction-wordmark-white.svg" alt="Sanction" className="h-3.5 w-auto" />
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
            <img src="/brand/sanction-wordmark-white.svg" alt="Sanction" className="h-3.5 w-auto" />
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
