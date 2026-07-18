import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Install",
  description:
    "Pick your channel, connect one agent, see your first governed decision in under 10 minutes.",
}

// DRAFT (Fable, 2026-07-18): the install center from the distribution review —
// one choose-your-channel page instead of docs archaeology. Content is real
// (commands verified against mcp-server.ts and the shipped docs); the shape is
// up for reaction. Not linked from the nav until Eric approves.

type Channel = {
  id: string
  name: string
  time: string
  audience: string
  steps: string[]
  docs?: string
  docsLabel?: string
}

const CHANNELS: Channel[] = [
  {
    id: "mcp",
    name: "MCP — Claude Desktop, Claude Code, any MCP host",
    time: "~5 min",
    audience: "The fastest path. Your agent host runs the tools; no code changes.",
    steps: [
      "Create a free wallet → you get an agent key (pxy_…)",
      'Add to your host config: { "sanction": { "command": "npx", "args": ["sanction-mcp"], "env": { "SANCTION_API_KEY": "pxy_…" } } }',
      "Ask your agent to buy something — watch Sanction answer before money moves",
    ],
    docs: "/docs/quickstart",
    docsLabel: "Quickstart",
  },
  {
    id: "gateway",
    name: "LLM Gateway — meter every model call",
    time: "~5 min",
    audience: "Point your OpenAI/Anthropic/Gemini base URL at Sanction; usage is metered server-side with budget caps.",
    steps: [
      "Create a wallet and agent key",
      "Swap your provider base URL for the Sanction gateway URL",
      "Watch spend accrue per model on the dashboard — budgets enforce automatically",
    ],
    docs: "/docs/gateway",
    docsLabel: "Gateway docs",
  },
  {
    id: "langchain",
    name: "LangChain / CrewAI",
    time: "~10 min",
    audience: "Framework adapters: authorization callbacks before spend and tool use.",
    steps: [
      "Create a wallet and agent key",
      "Add the Sanction callback/middleware from the adapter guide",
      "Run your chain — escalations pause for your approval, grants resume them",
    ],
    docs: "/docs/langchain",
    docsLabel: "LangChain guide",
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    time: "~15 min",
    audience: "Agents on Bedrock call Sanction as an action group — governance without leaving AWS.",
    steps: [
      "Create a wallet and agent key",
      "Register the Sanction action group from the Bedrock guide",
      "Invoke your agent — authorization decisions land in your audit log",
    ],
    docs: "/docs/bedrock",
    docsLabel: "Bedrock guide",
  },
]

const FIRST_SUCCESS = [
  "Wallet created (free, no card)",
  "One agent connected on your channel",
  "One authorize call answered — approved or escalated",
  "The decision visible in Approvals + the audit log",
]

export default function InstallPage() {
  return (
    <div
      className={`sanction ${brandFontVars}`}
      style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}
    >
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/start" className="sanction-link text-sm">Create a wallet →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Install Sanction</h1>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick the channel your agents already live in. Every path ends the same way:
          your first governed decision, in under ten minutes.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CHANNELS.map((c) => (
            <section
              key={c.id}
              className="rounded-lg border p-5"
              style={{ borderColor: "var(--paper-3)", background: "var(--surface-raised, transparent)" }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold">{c.name}</h2>
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 text-[11px]"
                  style={{ borderColor: "var(--paper-3)", color: "var(--text-muted)" }}
                >
                  {c.time}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{c.audience}</p>
              <ol className="mt-3 space-y-1.5 text-xs" style={{ color: "var(--text-body)" }}>
                {c.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: "var(--text-muted)" }}>{i + 1}.</span>
                    <span className="min-w-0 break-words">{s}</span>
                  </li>
                ))}
              </ol>
              {c.docs && (
                <p className="mt-3 text-xs">
                  <Link href={c.docs} className="sanction-link">{c.docsLabel} →</Link>
                </p>
              )}
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-lg border p-5" style={{ borderColor: "var(--paper-3)" }}>
          <h2 className="text-sm font-semibold">You&apos;re done when</h2>
          <ul className="mt-3 space-y-1.5 text-xs">
            {FIRST_SUCCESS.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: "var(--text-muted)" }}>☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
            Stuck anywhere on this list for more than ten minutes? That&apos;s a bug in the
            product, not in you — <Link href="/docs" className="sanction-link">docs</Link> has
            every channel in depth.
          </p>
        </section>

        <p className="mt-10 text-center">
          <Link
            href="/start"
            className="inline-block rounded-md px-5 py-2.5 text-sm font-medium"
            style={{ background: "var(--text-body)", color: "var(--surface-page)" }}
          >
            Start — create your wallet
          </Link>
        </p>
      </main>
    </div>
  )
}
