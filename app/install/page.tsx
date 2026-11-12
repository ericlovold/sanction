import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction connectors — Claude, Cursor, Codex, Grok, ChatGPT and Slack",
  description:
    "Find setup steps and listing availability for your AI host. Connect a host to request approval, or add Slack to review requests.",
}

const APPROVALS_URL = "https://getsanction.com/mcp/approvals"

const surfaces = [
  {
    id: "claude",
    name: "Claude",
    status: "Community listing · fresh installation unverified",
    href: "/docs/connect#host=claude&step=connect",
    linkLabel: "Claude connection steps →",
    directory: { href: "https://claude.ai/directory/sanction-approvals", label: "View Claude Community listing →" },
    steps: [
      "In Claude: Customize → Connectors → Add custom connector.",
      `Enter ${APPROVALS_URL}, choose automatic registration when offered, and complete Sanction consent.`,
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    status: "Community listing outside the official Cursor Marketplace",
    href: "/docs/connect#host=cursor&step=connect",
    linkLabel: "Cursor connection steps →",
    directory: { href: "https://cursor.directory/plugins/sanction", label: "View community plugin on Cursor Directory →" },
    steps: [
      "Merge this into .cursor/mcp.json or ~/.cursor/mcp.json, keeping any existing servers:",
      `{ "mcpServers": { "sanction": { "url": "${APPROVALS_URL}" } } }`,
      "Use Cursor's authentication control when prompted. This connects the approvals endpoint with OAuth. The separate community plugin uses an agent key for the full wallet.",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    status: "Custom MCP connection — host lifecycle test pending",
    href: "/docs/chatgpt-codex",
    linkLabel: "Codex setup and disconnect →",
    steps: [
      "With an active Sanction agent, run the following commands. Choose an unused server name if sanction is already taken.",
      "`codex mcp add sanction --url https://getsanction.com/mcp/approvals`",
      "`codex mcp login sanction`",
      "Approve the intended agent on Sanction's consent screen.",
    ],
  },
  {
    id: "grok",
    name: "Grok (consumer)",
    status: "Custom connector · sign-in and wallet read tested",
    href: "/docs/connect#host=grok-consumer&step=connect",
    linkLabel: "Grok connection steps →",
    steps: [
      "In Grok, open Connectors → New Connector → Custom.",
      `Enter ${APPROVALS_URL} and complete Sanction consent. The approval flow still needs a full test in Grok.`,
    ],
  },
  {
    id: "slack",
    name: "Slack",
    status: "Add to Slack is live — Slack Marketplace submission is not complete",
    href: "/slack",
    linkLabel: "Sanction for Slack →",
    steps: [
      "Slack delivers approval cards. It is not an MCP host. Adding Slack does not install Sanction in ChatGPT, Claude, or Cursor.",
      "Sign in as a wallet admin, open Add to Slack, pick a private channel that contains only the intended approvers, then Allow.",
      "Anyone in that channel can decide. Send a test escalation from Approvals to confirm delivery.",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    status: "No verified public listing",
    href: "/docs/chatgpt-codex",
    linkLabel: "ChatGPT availability →",
    steps: [
      "To connect today, use the Claude, Cursor, Codex, or Grok setup steps. A local Codex connection does not add Sanction to ChatGPT web.",
    ],
  },
] as const

export default function InstallPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/docs/connect" className="sanction-link">Connection guide</Link>
            <Link href="/start#create-account" className="sanction-link">Create account →</Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="sn-mono text-xs" style={{ color: "var(--ochre-7)" }}>INSTALL</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Find your Sanction connector.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Connect your AI tool to request a human decision. Add Slack if you want to review requests in a channel.
        </p>
        <nav className="mt-6 flex max-w-2xl flex-wrap gap-2" aria-label="Jump to your tool">
          {surfaces.map((surface) => (
            <a key={surface.id} href={`#${surface.id}`} className="sn-btn sn-btn-secondary sn-btn-s">{surface.name}</a>
          ))}
        </nav>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          For an OAuth connection, <Link href="/start#create-account" className="sanction-link" style={{ textDecoration: "underline" }}>sign in to your free account</Link> and choose an active agent from a wallet you own or administer.
        </p>

        <section className="mt-12 space-y-5" aria-label="Install paths">
          {surfaces.map((surface) => (
            <article
              key={surface.id}
              id={surface.id}
              className="scroll-mt-6 rounded-lg border p-5 sm:p-6"
              style={{ borderColor: "var(--paper-3)", borderTop: "2px solid var(--ochre-6)", background: "var(--surface-card)" }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold">{surface.name}</h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{surface.status}</p>
              </div>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {surface.steps.map((step) => (
                  <li key={step}>
                    {step.startsWith("`") || step.startsWith("{") ? <code className="block break-all text-[13px]">{step.replace(/^`|`$/g, "")}</code> : step}
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <Link href={surface.href} className="sanction-link">{surface.linkLabel}</Link>
                {"directory" in surface && <a href={surface.directory.href} className="sanction-link">{surface.directory.label}</a>}
              </div>
            </article>
          ))}
        </section>

        <section id="disconnect" className="mt-16 scroll-mt-6">
          <h2 className="text-2xl font-semibold tracking-tight">Disconnect</h2>
          <ul className="mt-4 max-w-2xl space-y-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            <li>
              <strong>AI host connections:</strong> revoke the host at{" "}
              <Link href="/connect/mcp" className="sanction-link">MCP connections</Link>
              . Then remove the connector in the host. Disconnect stops future requests; it does not undo completed decisions.
            </li>
            <li>
              <strong>Slack:</strong> disconnect the workspace on{" "}
              <Link href="/dashboard/approvals" className="sanction-link">Dashboard → Approvals</Link>
              . Uninstalling in Slack is separate; dashboard disconnect does not call Slack&apos;s token-revocation API.
            </li>
          </ul>
        </section>

        <section className="mt-12 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-body)" }}>What this does not do</h2>
          <p className="mt-3">
            The agent must ask Sanction and honor the decision. Connecting does not intercept other tools.
            Developers who want the API or gateway can use the <Link href="/docs/quickstart" className="sanction-link">quickstart</Link>.
          </p>
          <p className="mt-4">
            Full host evidence and limitations: <Link href="/docs/connect" className="sanction-link">connection guide</Link>
            . Help: <Link href="/support" className="sanction-link">support</Link>.
          </p>
        </section>
      </main>
    </div>
  )
}
