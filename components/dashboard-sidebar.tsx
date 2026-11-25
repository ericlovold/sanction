"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { ThemeToggle } from "@/components/theme-toggle"

// Dashboard navigation: a floating glass rail on desktop, a top bar plus a
// floating tab bar on phones. Active state is derived from the path.
// AccountControl is rendered server-side and passed in via `account` so this
// client component never imports a server component.

type Item = {
  href: string
  label: string
  icon: string
  // Other paths that belong to this item (pages reached from its hub).
  also?: string[]
  // Shown in the phone tab bar, which has room for five.
  tab?: boolean
}

// Minimal inline icons (no icon-lib dependency).
const ICON = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z",
  approvals: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  agents: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  usage: "M4 4v16h16M8 16v-4m5 4V7m5 9v-6",
  policy: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4",
  activity: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
}

// Two groups: what you decide and who acts, then money, rules and the record.
const primary: Item[] = [
  { href: "/dashboard", label: "Home", icon: ICON.home, tab: true },
  { href: "/dashboard/approvals", label: "Approvals", icon: ICON.approvals, tab: true },
  { href: "/dashboard/agents", label: "Agents", icon: ICON.agents, tab: true },
]

const secondary: Item[] = [
  { href: "/dashboard/usage", label: "Usage", icon: ICON.usage, also: ["/dashboard/connect", "/dashboard/ai-spend", "/dashboard/spend", "/dashboard/tools"] },
  { href: "/dashboard/policy", label: "Policy", icon: ICON.policy },
  { href: "/dashboard/audit", label: "Activity", icon: ICON.activity, tab: true },
]

const settings: Item = {
  href: "/dashboard/vault",
  label: "Settings",
  icon: ICON.settings,
  also: ["/dashboard/credentials", "/dashboard/providers", "/dashboard/team", "/dashboard/pools"],
  tab: true,
}

function isActive(pathname: string, item: Item): boolean {
  if (item.href === "/dashboard") return pathname === item.href
  return [item.href, ...(item.also ?? [])].some((p) => pathname.startsWith(p))
}

function NavLink({ item, active, pending }: { item: Item; active: boolean; pending: number }) {
  const showCount = item.href === "/dashboard/approvals" && pending > 0
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-tour={item.href.replace("/dashboard/", "nav-").replace("/dashboard", "nav-overview")}
      className="dash-link"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={item.icon} />
      </svg>
      <span>{item.label}</span>
      {showCount && (
        <span className="dash-count">
          {pending}
          <span className="sr-only"> waiting</span>
        </span>
      )}
    </Link>
  )
}

function Brand() {
  return (
    <Link href="/dashboard" className="dash-brand" aria-label="Sanction home">
      <img src="/brand/sanction-wordmark.svg" alt="" className="dash-logo-light" />
      <img src="/brand/sanction-wordmark-white.svg" alt="" className="dash-logo-dark" />
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
  // Kept so the layout does not change. Groups are sections on the home page.
  hasPools?: boolean
  account: ReactNode
  // WALLET-MEMBERS part 2: rendered instead of the static name line when the
  // session can act as more than one wallet.
  switcher?: ReactNode
}) {
  const pathname = usePathname()
  const link = (item: Item) => (
    <NavLink key={item.href} item={item} active={isActive(pathname, item)} pending={pendingCount} />
  )
  return (
    <>
      <aside className="dash-rail g-glass">
        <Brand />
        {switcher ?? (
          <p className="dash-wallet">
            {view.name}
            {!view.isSession && <span className="dash-wallet-tag">demo</span>}
          </p>
        )}
        <nav className="dash-nav" aria-label="Dashboard">
          {primary.map(link)}
          <div className="dash-nav-gap" aria-hidden />
          {secondary.map(link)}
          <div style={{ flex: 1 }} />
          {link(settings)}
        </nav>
        <div className="dash-foot">
          {account}
          <ThemeToggle collapsed />
        </div>
      </aside>

      <header className="dash-top g-glass md:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          {switcher}
          {account}
          <ThemeToggle collapsed />
        </div>
      </header>
      <nav className="dash-tabs g-glass md:hidden" aria-label="Dashboard">
        {[...primary, ...secondary, settings].filter((item) => item.tab).map(link)}
      </nav>
    </>
  )
}
