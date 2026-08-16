import type { Metadata } from "next"
import Link from "next/link"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import "../roster.css"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Vault",
  description: "Credentials, providers, and the people who can act on this wallet.",
}

const DRAWERS = [
  { href: "/dashboard/credentials", title: "Credentials", body: "Secrets the agents may inject. Encrypted. Shown never." },
  { href: "/dashboard/providers", title: "Providers", body: "Model keys in the vault. Agents hold Sanction keys only." },
  { href: "/dashboard/team", title: "People", body: "Who can approve, who can look, who holds the management key." },
  { href: "/dashboard/policy", title: "Policy", body: "The ladder on this group — approve, escalate, deny." },
  { href: "/dashboard/spend", title: "Spend", body: "Tokens, authorized spend, burn. The meter behind the cards." },
  { href: "/dashboard/audit", title: "Signed record", body: "Every decision, hash-chained. Evidence, not a log dump." },
]

export default async function VaultPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  return (
    <div className="roster px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--roster-brass)]">Vault</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{view.name}</h1>
        <p className="mt-2 text-sm text-[var(--roster-fog)]">
          Secrets, people, and the record. The roster stays the home.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {DRAWERS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="border border-[var(--roster-rule)] bg-[var(--roster-paper)] px-4 py-4 transition-colors hover:border-[var(--roster-brass)]"
            >
              <p className="text-sm font-medium text-[var(--roster-signal)]">{d.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--roster-fog)]">{d.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
