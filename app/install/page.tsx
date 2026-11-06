import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Install Sanction — ChatGPT, Codex, Claude, Cursor, Slack",
  description:
    "Install Sanction on ChatGPT, Codex, Claude, Cursor, or Slack. Create an account, connect one host, and disconnect when you are done. Connecting does not intercept other tools.",
}

const APPROVALS_URL = "https://getsanction.com/mcp/approvals"

const surfaces = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    status: "No verified public listing",
    href: "/docs/chatgpt-codex",
    linkLabel: "ChatGPT setup and disconnect →",
    steps: [
      "Create a Sanction account and an active agent first. OAuth needs a verified sign-in, not a management key.",
      "There is no verified ChatGPT directory listing to install from. A local Codex connection does not add Sanction to ChatGPT web.",
      "When OpenAI publishes the listing, install it from ChatGPT and complete Sanction consent. Until then, use Codex or another documented host.",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    status: "Custom MCP connection — host lifecycle test pending",
    href: "/docs/chatgpt-codex",
    linkLabel: "Codex setup and disconnect →",
    steps: [
      "Create a Sanction account and an active agent. Then run:",
      "`codex mcp add sanction --url https://getsanction.com/mcp/approvals`",
      "`codex mcp login sanction`",
      "Approve the intended agent on Sanction's consent screen. Use another server name if sanction is already taken.",
    ],
  },
  {
    id: "claude",
    name: "Claude",
    status: "Community directory listing exists — fresh-install lifecycle unverified",
    href: "/docs/connect#host=claude&step=connect",
    linkLabel: "Claude connection steps →",
    steps: [
      "In Claude: Customize → Connectors → Add custom connector.",
      `Enter ${APPROVALS_URL}, choose automatic registration when offered, and complete Sanction consent.`,
      "A Community listing exists at claude.ai/directory/sanction-approvals. That is not Verified status. Connecting does not intercept Claude's other tools.",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    status: "Custom MCP config — Cursor Marketplace rejected; community listing unpublished",
    href: "/docs/connect#host=cursor&step=connect",
    linkLabel: "Cursor connection steps →",
    steps: [
      "Merge this into .cursor/mcp.json or ~/.cursor/mcp.json, keeping any existing servers:",
      `{ "mcpServers": { "sanction": { "url": "${APPROVALS_URL}" } } }`,
      "Use Cursor's authentication control when prompted. This config contains no key.",
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
] as const

export default function InstallPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/docs/connect" className="sanction-link">Connection guide</Link>
            <Link href="/start" className="sanction-link">Create account →</Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="sn-mono text-xs" style={{ color: "var(--ochre-7)" }}>INSTALL</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Install Sanction on the tool you already use.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Create a Sanction account, connect one host, and ask for a human approval. Connecting does not intercept the host&apos;s other tools. The agent must ask Sanction and honor the decision.
        </p>
        <ol className="mt-6 max-w-2xl space-y-1 text-sm" aria-label="Before you install">
          <li>1. <Link href="/start" className="sanction-link">Create a free account</Link> with a verified sign-in. OAuth connections need a wallet you own or administer.</li>
          <li>2. Pick a surface below. Use the exact URL or command for that host.</li>
          <li>3. Check the connection, then send a synthetic test that executes nothing.</li>
        </ol>

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
              <Link href={surface.href} className="sanction-link mt-4 inline-block text-sm">{surface.linkLabel}</Link>
            </article>
          ))}
        </section>

        <section id="disconnect" className="mt-16 scroll-mt-6">
          <h2 className="text-2xl font-semibold tracking-tight">Disconnect</h2>
          <ul className="mt-4 max-w-2xl space-y-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            <li>
              <strong>ChatGPT, Codex, Claude, Cursor:</strong> revoke the host at{" "}
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
            Hosted MCP is cooperative. Listing presence is not a completed host test. The approvals URL is an MCP endpoint for hosts, not a page to open in a browser.
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
