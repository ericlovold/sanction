import type { Metadata } from "next"
import Link from "next/link"
import { SlackInstallCta } from "@/components/slack-install-cta"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction for Slack — Approve agent actions in-channel",
  description: "Connect Sanction to Slack so your team can approve or deny governed agent actions without leaving the channel.",
}

export default function SlackPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/docs" className="sanction-link text-sm">Documentation</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-20">
        <p className="sn-mono text-xs" style={{ color: "var(--pine-7)" }}>SANCTION FOR SLACK</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Keep the approval loop where your team works.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          When an agent crosses a policy boundary, Sanction posts the decision to a channel you choose. An admin can approve or deny it there; Sanction records the actor and mints the same one-use grant the dashboard would.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <SlackInstallCta />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>A Sanction admin account is required.</span>
        </div>

        <section className="mt-20 grid gap-5 md:grid-cols-3">
          {[
            ["1. Connect", "An admin chooses the Slack workspace and channel. Sanction stores the workspace bot token encrypted."],
            ["2. Decide", "Escalations arrive with Approve, Deny, and Review in Sanction controls."],
            ["3. Continue safely", "Approval produces a single-use, expiring grant; denial stops the agent. Every outcome remains auditable."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-lg border p-5" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)" }}>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{body}</p>
            </article>
          ))}
        </section>

        <p className="mt-12 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Slack is the human approval surface. Developers install Sanction through MCP, the SDK, or the REST API; the same policy and decision record applies across every surface.
        </p>
      </main>
    </div>
  )
}
