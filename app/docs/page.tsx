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
    tag: "MCP governance",
    title: "Govern MCP tools before they run",
    body: "Register an upstream once, vault its credential, and point MCP hosts at Sanction's broker. Destructive calls deny, merges and deploys escalate, and an agent never receives the upstream token.",
    link: { label: "MCP broker workflow", href: "/docs/governed-workflows" },
  },
  {
    tag: "Internal AI governance",
    title: "Cap AI spend by team without instrumenting every call",
    body: "Model clients change one base URL and header. Department wallets set budgets and cascade caps; Finance gets chargeback and signed evidence from the same ledger that enforced the limit.",
    link: { label: "LLM spend workflow", href: "/docs/governed-workflows" },
  },
  {
    tag: "Agent payments",
    title: "Authorize x402 before the wallet signs",
    body: "Price a payment challenge, run the existing spend ladder, and sign only after approval. Brokered refusals withhold the payment requirements, so a hijacked agent cannot construct the transfer.",
    link: { label: "x402 workflow", href: "/docs/governed-workflows" },
  },
]

const concepts = [
  { title: "How Sanction works", desc: "The architecture in one diagram: identity upstream, one atomic decision, evidence.", href: "/architecture" },
  { title: "Why Sanction", desc: "Six claims on why authorization is its own system.", href: "/why" },
  { title: "Authorization: the decision", desc: "Wallets, agents, the ladder, grants — and the invariants.", href: "/docs/authorization" },
  { title: "Evidence & replay", desc: "Revisions, stored contexts, replay with proof, what-if simulation.", href: "/docs/evidence-and-replay" },
  { title: "Capability governance", desc: "New powers ask first — skills and plugins governed like money.", href: "/docs/capability-governance" },
  { title: "Security & threat model", desc: "Trust boundaries, fail-closed invariants, vault encryption, tenant isolation, disclosure.", href: "/docs/security" },
  { title: "EU AI Act", desc: "Evidence + oversight for the agents you run: Art 12/13/14 mapped to signed audit, transparency, and human approvals.", href: "/compliance" },
]

const ecosystem = [
  { title: "Compatibility", desc: "Badges, channel packs, and install paths for MCP, frameworks, gateways, and payment-agent pilots.", href: "/compatibility" },
  { title: "Compatibility & badges", desc: "When each ecosystem claim is true, and which Sanction surface proves it.", href: "/docs/compatibility" },
  { title: "Framework adapters", desc: "SanctionMiddleware, Python wrappers, and LiteLLM callback recipes.", href: "/docs/framework-adapters" },
]

const licensing = [
  {
    title: "Commercial License",
    desc: "FSL vs commercial use, typical buyers, Sanction Local, and what enterprise agreements cover.",
    href: "/docs/commercial-license",
  },
  {
    title: "FSL source license",
    desc: "Functional Source License 1.1 — full text in the repo (converts to MIT after two years).",
    href: "https://github.com/ericlovold/sanction/blob/main/LICENSE",
  },
]

const deeper = [
  { title: "Quickstart", desc: "First metered, governed call in under five minutes.", href: "/docs/quickstart" },
  { title: "The LLM gateway", desc: "Meter and cap every token across providers on one key — 402 when over budget.", href: "/docs/gateway" },
  { title: "Vercel AI SDK guide", desc: "Drop Sanction into the AI SDK with two lines of config.", href: "/docs/ai-sdk" },
  { title: "LangChain guide", desc: "Meter and cap LangChain calls; authorize before spend.", href: "/docs/langchain" },
  { title: "CrewAI guide", desc: "Give the crew an authorize tool it must clear to spend.", href: "/docs/crewai" },
  { title: "AWS Bedrock Agents guide", desc: "Action Group setup: schema subset, forwarder Lambda, first governed decision.", href: "/docs/bedrock" },
  { title: "Agent fleets guide", desc: "Channels as pools, seats as keys, envelopes with escalation — and native cost-per-outcome ceilings.", href: "/docs/agent-fleets" },
  { title: "Pay-per-crawl guide", desc: "The web charges your agents now — govern every 402 quote with budgets, escalation, and audit.", href: "/docs/pay-per-crawl" },
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
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Docs</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Get started</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Govern your agents&apos; token spend — across every provider, user, and system. Here&apos;s the fastest path
          from zero to a metered, capped, audited agent.
        </p>

        {/* Quickstart */}
        <section className="mt-12 space-y-8">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-border pt-8">
              <div className="flex items-baseline gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                  {s.n}
                </span>
                <h2 className="font-display text-xl font-semibold tracking-tight">{s.title}</h2>
              </div>
              <p className="mt-2 pl-9 text-muted-foreground">{s.desc}</p>
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
          <p className="mt-2 text-muted-foreground">Patterns teams reach for first.</p>
          <div className="mt-6 space-y-5">
            {workflows.map((w) => (
              <div key={w.title} className="rounded-lg border border-border bg-muted/50 p-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/90">{w.tag}</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">{w.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{w.body}</p>
                <a href={w.link.href} className="mt-3 inline-block text-sm font-medium text-emerald-400 hover:text-emerald-300">
                  {w.link.label} →
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Concepts — the model, not just the APIs */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Concepts</h2>
          <p className="mt-2 text-muted-foreground">The model behind the endpoints — read these once and every API makes sense.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {concepts.map((d) => (
              <a key={d.title} href={d.href} className="rounded-lg border border-border bg-muted/50 p-4 transition-colors hover:border-foreground/30">
                <p className="font-medium text-foreground">{d.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Ecosystem distribution */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Ecosystem distribution</h2>
          <p className="mt-2 text-muted-foreground">Where Sanction fits into the tools agents already use.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {ecosystem.map((d) => (
              <a key={d.title} href={d.href} className="rounded-lg border border-border bg-muted/50 p-4 transition-colors hover:border-foreground/30">
                <p className="font-medium text-foreground">{d.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Licensing */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Licensing</h2>
          <p className="mt-2 text-muted-foreground">Free for your own agents. Commercial license when your product embeds or resells governance.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {licensing.map((d) => (
              <a key={d.title} href={d.href} className="rounded-lg border border-border bg-muted/50 p-4 transition-colors hover:border-foreground/30">
                <p className="font-medium text-foreground">{d.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Go deeper */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Go deeper</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {deeper.map((d) => (
              <a key={d.title} href={d.href} className="rounded-lg border border-border bg-muted/50 p-4 transition-colors hover:border-foreground/30">
                <p className="font-medium text-foreground">{d.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-16 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-6 text-center">
          <h2 className="font-display text-xl font-semibold tracking-tight">Ready to govern your agents?</h2>
          <p className="mt-2 text-sm text-muted-foreground">Free to start. No card required. Two keys and you&apos;re live.</p>
          <Link href="/start" className="mt-4 inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            Start free →
          </Link>
        </section>
      </main>
    </div>
  )
}
