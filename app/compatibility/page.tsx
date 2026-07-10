import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"
import { POLICY_PACKS } from "@/lib/policyPacks"

export const metadata: Metadata = {
  title: "Compatibility — Sanction",
  description:
    "Compatibility badges, channel policy packs, and adapter paths for MCP hosts, agent frameworks, LLM gateways, and payment-agent pilots.",
}

const badges = [
  { label: "Sanction-governed MCP", proof: "MCP tools ask before risky work" },
  { label: "AuthZEN PDP compatible", proof: "Standard PEP/PDP evaluation wire" },
  { label: "AARP approval loop", proof: "Escalation opens an access request" },
  { label: "Gateway metered", proof: "Model calls are budgeted before/after use" },
  { label: "Evidence replay ready", proof: "Decision context can reproduce the call" },
]

const channels = [
  {
    title: "MCP hosts",
    body: "Cursor, Claude Desktop, Claude Code, Windsurf, Codex, and custom MCP hosts can add `npx sanction-mcp` as the governance tool server.",
    pack: "mcp-tool-governance",
  },
  {
    title: "Coding agents",
    body: "Coding and research agents can read freely while writes, shell, deploys, and new capabilities escalate to a human.",
    pack: "coding-agent-seat",
  },
  {
    title: "LLM gateways",
    body: "Use Sanction as the gateway for the pilot, or keep LiteLLM/Portkey/Helicone and call Sanction as the external policy authority.",
    pack: "gateway-token-budget",
  },
  {
    title: "AI agencies",
    body: "Hand clients a visible launch policy: budgets, approval for risky actions, Slack/webhook notifications, and replayable evidence.",
    pack: "agency-client-safe-launch",
  },
  {
    title: "Payment agents",
    body: "Put policy, consent, and evidence before AP2, x402, checkout, procurement, or any other payment rail.",
    pack: "payment-agent-mandate",
  },
  {
    title: "Sanction Local",
    body: "Air-gapped installs: only on-box tools pass; every cloud call is denied and persisted so the assessor can read the proof.",
    pack: "no-egress",
  },
]

function packName(id: string) {
  return POLICY_PACKS.find((p) => p.id === id)?.name ?? id
}

export default function CompatibilityPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />
      <main className="mx-auto max-w-5xl px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Ecosystem</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Compatibility</h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-400">
          Sanction fits where agents already run: MCP hosts, coding agents, framework runtimes, LLM gateways, and
          payment-agent pilots. The common contract is simple: authorize before the agent acts.
        </p>

        <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {badges.map((badge) => (
            <div key={badge.label} className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <p className="text-sm font-semibold text-emerald-300">{badge.label}</p>
              <p className="mt-2 text-xs text-zinc-500">{badge.proof}</p>
            </div>
          ))}
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Channel policy packs</h2>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Each pack is an installable starting policy. Preview it against the last 30 days before applying it.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {channels.map((channel) => (
              <div key={channel.title} className="rounded-xl border border-zinc-800 bg-zinc-900/45 p-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/90">
                  {packName(channel.pack)}
                </p>
                <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">{channel.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{channel.body}</p>
                <code className="mt-4 block rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                  {channel.pack}
                </code>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 grid gap-4 md:grid-cols-3">
          <Link href="/docs/compatibility" className="rounded-xl border border-zinc-800 bg-zinc-900/45 p-5 hover:border-zinc-700">
            <h2 className="font-display text-lg font-semibold tracking-tight">Badge rules</h2>
            <p className="mt-2 text-sm text-zinc-400">When to claim MCP, AuthZEN, gateway, and replay compatibility.</p>
          </Link>
          <Link href="/docs/framework-adapters" className="rounded-xl border border-zinc-800 bg-zinc-900/45 p-5 hover:border-zinc-700">
            <h2 className="font-display text-lg font-semibold tracking-tight">Adapter recipes</h2>
            <p className="mt-2 text-sm text-zinc-400">SanctionMiddleware, Python wrappers, and LiteLLM callback patterns.</p>
          </Link>
          <a href="/api/openapi.json" className="rounded-xl border border-zinc-800 bg-zinc-900/45 p-5 hover:border-zinc-700">
            <h2 className="font-display text-lg font-semibold tracking-tight">OpenAPI</h2>
            <p className="mt-2 text-sm text-zinc-400">Build an adapter against the same endpoints the dashboard and SDK use.</p>
          </a>
        </section>
      </main>
    </div>
  )
}
