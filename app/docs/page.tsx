import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"

export const metadata: Metadata = {
  title: "Sanction Docs — Get started",
  description:
    "Get started with Sanction in minutes: create an agent, route model calls through the gateway to meter and cap spend, and authorize actions before money moves. Plus common workflows for overnight agents, multi-tenant platforms, and cross-provider cost control.",
}

const gatewaySnippet = `import OpenAI from "openai"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,                       // your key — Sanction forwards it
  baseURL: "https://getsanction.com/api/gateway/openai/v1", // route through Sanction
  defaultHeaders: { "x-sanction-key": "pxy_your_agent_key" },
})
// call client as normal — every token is metered and capped, then forwarded to OpenAI`

const authorizeSnippet = `curl -X POST https://getsanction.com/api/v1/authorize \\
  -H "x-api-key: pxy_your_agent_key" \\
  -H "content-type: application/json" \\
  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'

# → { "authorized": true, "status": "approved", "request_id": "req_…" }
# Raise amount_usd to 40 and it comes back "escalated" — a human approves before it spends.`

const provisionSnippet = `# Create an agent per tenant (management key — server-side only)
curl -X POST https://getsanction.com/api/v1/agents \\
  -H "x-mgmt-key: sk_your_management_key" \\
  -H "content-type: application/json" \\
  -d '{"wallet_id":"wlt_…","name":"tenant_42"}'
# → returns a pxy_ key (shown once) for that tenant's agent`

const REPO = "https://github.com/ericlovold/sanction/blob/main/docs"

const steps = [
  {
    n: "1",
    title: "Create your account",
    desc: "Sign up free and get two keys, shown once: an agent key (pxy_) for your agents, and a management key (sk_) for provisioning and policy. No card required.",
    cta: { label: "Create a wallet →", href: "/start" },
  },
  {
    n: "2",
    title: "Route model calls through the gateway",
    desc: "Point your model SDK's base URL at Sanction and add the x-sanction-key header. You keep your own provider key — Sanction meters every token and enforces the budget, across providers, on one key.",
    code: gatewaySnippet,
  },
  {
    n: "3",
    title: "Authorize actions before money moves",
    desc: "Before an agent spends, it asks. Sanction returns approve, escalate, or deny in real time. Small charges clear, risky ones escalate to a human, blocked ones never run, and every decision is logged.",
    code: authorizeSnippet,
  },
]

const workflows = [
  {
    tag: "Overnight agents",
    title: "Cap the agent that runs all night",
    body: "An autonomous coding or research agent works your backlog overnight, burning tokens while you sleep. Set a daily token budget on the agent — the gateway returns 402 and stops the call the moment the cap is hit, before the overrun.",
    link: { label: "Gateway reference", href: `${REPO}/GATEWAY.md` },
  },
  {
    tag: "Multi-tenant platforms",
    title: "Govern many agents under one account",
    body: "Running agents for many customers? Provision one agent per tenant under a master account, set per-tenant budgets, and roll spend up for chargeback. One place to govern the whole fleet.",
    code: provisionSnippet,
    link: { label: "Multi-tenant runbook", href: "/docs/multi-tenant" },
  },
  {
    tag: "Cross-provider cost control",
    title: "See and cap spend across every provider",
    body: "Token pricing is the digital Wild West — rates change mid-cycle, and the question becomes which provider to use. Route Anthropic, OpenAI, and Gemini through one gateway and one key; every call is metered and capped in one place.",
    link: { label: "Vercel AI SDK guide", href: "/docs/ai-sdk" },
  },
]

const deeper = [
  { title: "Quickstart", desc: "First metered, governed call in under five minutes.", href: "/docs/quickstart" },
  { title: "Vercel AI SDK guide", desc: "Drop Sanction into the AI SDK with two lines of config.", href: "/docs/ai-sdk" },
  { title: "LangChain guide", desc: "Meter and cap LangChain calls; authorize before spend.", href: "/docs/langchain" },
  { title: "CrewAI guide", desc: "Give the crew an authorize tool it must clear to spend.", href: "/docs/crewai" },
  { title: "Multi-tenant Integration Runbook", desc: "Provision per tenant, govern budgets, rotate keys.", href: "/docs/multi-tenant" },
  { title: "Full API reference", desc: "OpenAPI 3.0 spec — every endpoint, Bedrock-compatible.", href: "/api/openapi.json" },
]

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 text-[12.5px] leading-relaxed text-zinc-300">
      <code>{children}</code>
    </pre>
  )
}

export default function Docs() {
  return (
    <div className="min-h-screen">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Docs</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Get started</h1>
        <p className="mt-3 text-lg text-zinc-400">
          Govern your agents&apos; token spend — across every provider, user, and system. Here&apos;s the fastest path
          from zero to a metered, capped, audited agent.
        </p>

        {/* Quickstart */}
        <section className="mt-12 space-y-8">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-zinc-900 pt-8">
              <div className="flex items-baseline gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                  {s.n}
                </span>
                <h2 className="font-display text-xl font-semibold tracking-tight">{s.title}</h2>
              </div>
              <p className="mt-2 pl-9 text-zinc-400">{s.desc}</p>
              <div className="pl-9">
                {s.code && <Code>{s.code}</Code>}
                {s.cta && (
                  <Link href={s.cta.href} className="mt-3 inline-block text-sm font-medium text-emerald-400 hover:text-emerald-300">
                    {s.cta.label}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* Common workflows */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Common workflows</h2>
          <p className="mt-2 text-zinc-400">Patterns teams reach for first.</p>
          <div className="mt-6 space-y-5">
            {workflows.map((w) => (
              <div key={w.title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/90">{w.tag}</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">{w.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{w.body}</p>
                {w.code && <Code>{w.code}</Code>}
                <a href={w.link.href} className="mt-3 inline-block text-sm font-medium text-emerald-400 hover:text-emerald-300">
                  {w.link.label} →
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Go deeper */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Go deeper</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {deeper.map((d) => (
              <a key={d.title} href={d.href} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700">
                <p className="font-medium text-zinc-100">{d.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{d.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-16 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-6 text-center">
          <h2 className="font-display text-xl font-semibold tracking-tight">Ready to govern your agents?</h2>
          <p className="mt-2 text-sm text-zinc-400">Free to start. No card required. Two keys and you&apos;re live.</p>
          <Link href="/start" className="mt-4 inline-block rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
            Start free →
          </Link>
        </section>
      </main>
    </div>
  )
}
