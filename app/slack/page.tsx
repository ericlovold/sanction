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
        <p className="sn-mono text-xs" style={{ color: "var(--ochre-7)" }}>SANCTION FOR SLACK</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">An agent needs a decision. Your team is already here.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Review a proposed action in Slack, approve or deny it, and keep a record of who decided. Sanction sends approval requests to your chosen channel when a connected agent asks for a human decision or its policy requires one.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <SlackInstallCta />
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            No wallet yet? <Link href="/start" className="sanction-link">Create one first</Link> — Add to Slack needs an admin session.
          </span>
        </div>

        <section className="mt-20 grid gap-5 md:grid-cols-3">
          {[
            ["1. Connect", "An admin chooses the workspace and channel, then sends a test escalation to check the connection. Sanction stores the bot token encrypted."],
            ["2. Decide", "Requests arrive with Approve, Deny, and Review in Sanction. Anyone in the chosen channel can decide, so use a private channel for your approvers."],
            ["3. Continue safely", "Approval gives the agent a single-use, expiring grant to redeem. A denial tells it to stop. Sanction records the decision and the Slack actor."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-lg border p-5" style={{ borderColor: "var(--paper-3)", borderTop: "2px solid var(--ochre-6)", background: "var(--surface-card)" }}>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{body}</p>
            </article>
          ))}
        </section>

        <p className="mt-12 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Slack is where people decide. The agent must be connected to Sanction and honor the answer; adding Slack does not intercept its tools.
        </p>
        <Link href="/docs/connect" className="sanction-link mt-4 inline-block text-sm">Connect an agent and try one approval →</Link>
        <nav aria-label="Slack app resources" className="mt-6 flex flex-wrap gap-5 text-sm">
          <Link href="/privacy" className="sanction-link">Privacy policy</Link>
          <Link href="/support" className="sanction-link">Support</Link>
        </nav>
      </main>
    </div>
  )
}
