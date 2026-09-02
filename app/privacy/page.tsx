import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction privacy policy",
  description: "What Sanction stores, why, for how long, and how to remove it.",
}

const sections: [string, string[]][] = [
  [
    "What Sanction is",
    [
      "Sanction is an authorization service for AI agents, operated by Sanction AI (Eric Lovold) in Minnesota, United States. Agents ask it whether an action may proceed; people approve or deny escalations. This policy covers getsanction.com, the API, the hosted MCP endpoint, and the Sanction for Slack app.",
    ],
  ],
  [
    "What we store",
    [
      "Account data: the email address used to sign in (Google, GitHub, Apple, or a management key), wallet and team membership, and roles.",
      "Decision records: each authorization request an agent makes — action, amount, merchant or resource, category, the free-text description the agent supplied, the decision, the policy revision in force, and the evaluated context. This is the audit trail the product exists to keep.",
      "Usage metering: model, token counts, and computed cost for calls through the gateway. Prompt and response bodies are not stored.",
      "Vaulted credentials: secrets you choose to store are encrypted per wallet with keys wrapped by AWS KMS. They are decrypted only to fulfil an authorized injection or a gateway call and are never logged.",
      "Slack: on install we store the workspace id and name, the channel id and name, the installing user's Slack id, and the workspace bot token (encrypted like a credential). On a button click we record the Slack username as the actor of that decision. We do not read channel messages.",
      "Notification routes: webhook URLs and their signing secrets.",
      "Operational logs and analytics: request metadata and anonymous product-usage events (Vercel Analytics). No advertising trackers.",
    ],
  ],
  [
    "Why",
    [
      "To decide and record authorizations, deliver escalations to the people who must act on them, meter usage against budgets, and produce the audit evidence owners and their assessors rely on. We do not sell data and do not use it to train models.",
    ],
  ],
  [
    "Who else sees it",
    [
      "Infrastructure providers under contract: Vercel (hosting), Neon (Postgres), AWS (key management), Resend (email), and Slack (when you connect a workspace). Model providers receive only the traffic you route through the gateway, under your own provider account.",
    ],
  ],
  [
    "How long",
    [
      "Decision records and audit events are kept for the life of the wallet, because their value is that they persist. Vaulted credentials and Slack installs are revoked on disconnect and retained encrypted only as revoked rows. Deleting a wallet removes its data; email eric@getsanction.com to request deletion.",
    ],
  ],
  [
    "Your controls",
    [
      "Disconnect Slack or any notification route from the Approvals page at any time. Rotate or revoke agent keys, execution tokens, and wallet encryption keys from the dashboard or API. Export your decisions with GET /audit/export.",
    ],
  ],
  [
    "Changes and contact",
    [
      "This policy is versioned in the public repository; the date below is its last revision. Questions: eric@getsanction.com.",
    ],
  ],
]

export default function PrivacyPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/support" className="sanction-link text-sm">Support</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="sn-mono text-xs" style={{ color: "var(--pine-7)" }}>PRIVACY POLICY · REVISED 2 SEPTEMBER 2026</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">What Sanction stores, and why.</h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Written to be read. Sanction keeps the records an authorization layer must keep, encrypts the secrets it is trusted with, and stores nothing it does not need to decide, notify, or prove.
        </p>
        <div className="mt-14 space-y-10">
          {sections.map(([title, paras]) => (
            <section key={title}>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              <ul className="mt-3 space-y-3">
                {paras.map((p) => (
                  <li key={p} className="text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{p}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
