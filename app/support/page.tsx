import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction support",
  description: "How to reach Sanction for help, questions, and security reports.",
}

const rows: [string, string, string][] = [
  ["Help and questions", "eric@getsanction.com", "mailto:eric@getsanction.com?subject=Sanction%20support"],
  ["Security reports", "eric@getsanction.com — no public issues, please", "mailto:eric@getsanction.com?subject=Sanction%20security%20report"],
  ["Documentation", "getsanction.com/docs", "/docs"],
  ["Source and issues", "github.com/ericlovold/sanction", "https://github.com/ericlovold/sanction/issues"],
  ["Status of your install", "Dashboard → Approvals shows connected Slack workspaces and routes", "/dashboard/approvals"],
]

export default function SupportPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/docs" className="sanction-link text-sm">Documentation</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-20">
        <p className="sn-mono text-xs" style={{ color: "var(--pine-7)" }}>SUPPORT</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight">A person answers.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Sanction is run by a small team. Email reaches the person who built it. Expect a reply within one business day, sooner for anything that blocks an approval or a governed agent.
        </p>
        <div className="mt-12 overflow-hidden rounded-lg border" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)" }}>
          {rows.map(([label, value, href]) => (
            <div key={label} className="grid gap-2 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[200px_1fr]" style={{ borderColor: "var(--paper-3)" }}>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-sm">
                <a className="sanction-link" href={href}>{value}</a>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          For the Slack app: disconnecting a workspace is one click on the Approvals page and revokes the install immediately. The <Link href="/privacy" className="sanction-link">privacy policy</Link> describes what Sanction stores.
        </p>
      </main>
    </div>
  )
}
