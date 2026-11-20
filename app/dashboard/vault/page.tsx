import type { Metadata } from "next"
import Link from "next/link"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Settings",
  description: "People, groups, credentials, model providers and connected AI tools for this wallet.",
}

// The settings hub. Policy, Spend and Activity are in the navigation; this
// page holds what is set up once and changed rarely. The URL stays /vault so
// existing links keep working.
const SETTINGS = [
  { href: "/dashboard/team", title: "People", body: "Who can approve, who can look, and who holds the management key." },
  { href: "/dashboard/pools", title: "Groups", body: "Teams and departments, each with its own agents and budget." },
  { href: "/connect/mcp", title: "Connected AI tools", body: "The AI tools that can ask this wallet for approval." },
  { href: "/dashboard/credentials", title: "Credentials", body: "Secrets your agents may use. Stored encrypted and never shown again." },
  { href: "/dashboard/providers", title: "Model providers", body: "Your model API keys. Agents hold a Sanction key, never these." },
]

export default async function SettingsPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  return (
    <div className="home" style={{ maxWidth: 820 }}>
      <h1 className="home-title">Settings</h1>
      <p className="home-sub">{view.name}</p>
      <div className="g-panel home-section">
        {SETTINGS.map((item) => (
          <Link key={item.href} href={item.href} className="set-row">
            <span>
              <span className="set-title">{item.title}</span>
              <span className="set-body">{item.body}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="g-chev" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  )
}
