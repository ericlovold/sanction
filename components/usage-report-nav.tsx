"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const reports = [
  { label: "Client sessions", href: "/dashboard/usage", paths: ["/dashboard/usage", "/dashboard/connect"] },
  { label: "Tool billing", href: "/dashboard/ai-spend", paths: ["/dashboard/ai-spend", "/dashboard/usage/cursor", "/dashboard/usage/grok-bot"] },
  { label: "Spend & budgets", href: "/dashboard/spend", paths: ["/dashboard/spend"] },
]

export function UsageReportNav() {
  const path = usePathname()
  const active = reports.find(report => report.paths.includes(path))
  if (!active) return null

  return (
    <nav aria-label="Usage reports" className="mx-auto flex w-full max-w-6xl flex-wrap gap-1 px-5 pt-5">
      {reports.map(report => (
        <Link key={report.href} href={report.href}
          aria-current={report === active ? (path === report.href ? "page" : "location") : undefined}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current]:bg-primary aria-[current]:text-primary-foreground">
          {report.label}
        </Link>
      ))}
    </nav>
  )
}
