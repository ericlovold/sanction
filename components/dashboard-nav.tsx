import Link from "next/link"

const tabs = [
  { href: "/dashboard", label: "Overview", key: "overview" },
  { href: "/dashboard/keys", label: "Keys", key: "keys" },
  { href: "/dashboard/spend", label: "Spend", key: "spend" },
  { href: "/dashboard/approvals", label: "Approvals", key: "approvals" },
  { href: "/dashboard/grants", label: "Grants", key: "grants" },
] as const

export function DashboardNav({ active }: { active: "overview" | "keys" | "spend" | "approvals" | "grants" }) {
  return (
    <nav className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active === t.key
              ? "bg-zinc-100 text-zinc-950"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
