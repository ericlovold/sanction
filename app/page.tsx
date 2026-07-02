import type { Metadata } from "next"
import Link from "next/link"
import { integrations } from "@/lib/integrations"
import { LeadCapture } from "@/components/lead-capture"

export const metadata: Metadata = {
  title: "Sanction — The authorization layer for AI agents",
  description:
    "Sanction is the authorization and credential layer for autonomous AI agents: set spend limits, approve or deny each action before it runs, and inject short-lived scoped secrets — across MCP, REST, and AWS Bedrock.",
}

const pillars = [
  {
    name: "Agent Wallet",
    tag: "Authorize",
    desc:
      "Spend authorization with policy enforcement. Auto-approve under threshold, escalate over it, deny what's blocked. Daily and monthly budgets per agent.",
    points: ["Per-transaction & daily limits", "Auto-approve / escalate / deny", "Category allow & block lists"],
  },
  {
    name: "Credential Vault",
    tag: "Protect",
    desc:
      "AES-256-GCM encrypted credentials at rest. Scoped execution JWTs with a 15-minute TTL gate every injection. Nothing leaves the vault unlogged.",
    points: ["AES-256-GCM at rest", "Scoped 15-min execution tokens", "Every access audit-logged"],
  },
  {
    name: "Clearance Levels",
    tag: "Govern",
    desc:
      "A 1–5 clearance system with industry-specific domain authorization. Agents only ever touch what they're explicitly cleared for.",
    points: ["1–5 clearance tiers", "Domain-scoped authorization", "Fail-closed by default"],
  },
]

const tiers = [
  {
    name: "Free",
    price: "$0",
    cadence: "no card",
    blurb: "The whole platform. Govern as many agents as you want.",
    features: [
      "Unlimited agents & wallets",
      "Unlimited authorizations",
      "Token budgets + the LLM gateway",
      "Approvals, credential vault & audit log",
    ],
    cta: "Start free",
    href: "/start",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    cadence: "",
    blurb: "For teams and regulated deployments. Roadmap capabilities; talk to us about timing.",
    features: [
      "SSO & team roles",
      "Audit log export",
      "On-prem / air-gapped install",
      "SLA & dedicated support",
    ],
    cta: "Contact us",
    href: "mailto:eric@getsanction.com?subject=Sanction%20Enterprise",
    highlight: false,
  },
]

const authorizeSnippet = `curl -X POST https://getsanction.com/api/v1/authorize \\
  -H "x-api-key: pxy_••••" \\
  -H "content-type: application/json" \\
  -d '{
    "action": "purchase",
    "merchant": "openai",
    "amount_usd": 12.50,
    "category": "services"
  }'

# → { "authorized": true, "status": "approved", "request_id": "req_…" }`

const steps = [
  {
    n: "1",
    title: "Register an agent",
    desc: "Create a wallet and issue a scoped pxy_ API key for each agent. The key is its identity — every call it makes is attributable.",
    meta: "POST /v1/agents",
  },
  {
    n: "2",
    title: "Set a policy",
    desc: "Define the rules once: daily and per-transaction budgets, auto-approve and escalation thresholds, allowed and blocked categories, clearance level.",
    meta: "POST /v1/wallets",
  },
  {
    n: "3",
    title: "Authorize in real time",
    desc: "Before the agent spends, it calls /authorize. Sanction returns approve, escalate, or deny in real time, and logs every decision for audit.",
    meta: "POST /v1/authorize",
  },
]

const toneClass: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  red: "bg-red-500/15 text-red-400 border-red-500/25",
}

const outcomes = [
  { label: "Approved", tone: "emerald", desc: "Under the threshold and in an allowed category. The agent proceeds; the spend is logged." },
  { label: "Escalated", tone: "amber", desc: "Over your escalation limit. The request pauses and waits for a human to approve or reject." },
  { label: "Denied", tone: "red", desc: "Blocked category or over the hard cap. The transaction never reaches the merchant." },
]

const useCases = [
  {
    tag: "Coding & research agents",
    title: "The agent that runs all night",
    scenario:
      "An autonomous coding agent works your backlog overnight — calling Claude, hitting APIs, spinning up sandboxes. Costs compound while you sleep.",
    bullets: [
      "A daily token budget caps the burn — it stops before it overruns.",
      "Every model call is logged with cost, model, and task label.",
      "A job that needs $200 of compute escalates to you instead of just running.",
    ],
  },
  {
    tag: "Procurement & ops agents",
    title: "The agent that pays the bills",
    scenario:
      "An ops agent renews SaaS, pays contractors, and buys data. You want it autonomous for the routine and gated for the rest.",
    bullets: [
      "Routine renewals under $25 auto-approve — no human in the loop.",
      "Anything over $100, or in a blocked category, routes to you or stops cold.",
      "Payment credentials inject from the vault and expire 15 minutes later.",
    ],
  },
]

// Structured data so search and AI answer engines read what Sanction *is* —
// agent authorization — and not the AML/sanctions-screening category the name
// otherwise gets pattern-matched into. The FAQ negation is the explicit fix.
const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sanction",
    url: "https://getsanction.com",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, API",
    description:
      "Sanction is the authorization and credential layer for autonomous AI agents — spend authorization, scoped credential injection, and an audit trail. It is not a sanctions-screening, watchlist, or AML compliance tool.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Is Sanction a sanctions-screening or AML compliance tool?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Despite the name, Sanction is not a sanctions, watchlist, or AML screening product. Sanction is the authorization and credential layer for autonomous AI agents — it decides whether an AI agent may spend money or use a secret before it acts, and logs every decision.",
        },
      },
      {
        "@type": "Question",
        name: "What does Sanction do?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Sanction gives AI agents a wallet with spend limits, a vault for scoped short-lived credentials, and an audit log. Before an agent spends money or uses a secret, it asks Sanction, which approves, escalates to a human, or denies — across MCP, REST, and AWS Bedrock.",
        },
      },
    ],
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-display font-semibold tracking-tight">
            Sanction
          </Link>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <a href="#how" className="hidden sm:inline hover:text-zinc-100 transition-colors">How it works</a>
            <a href="#use-cases" className="hidden md:inline hover:text-zinc-100 transition-colors">Use cases</a>
            <a href="#integrations" className="hidden md:inline hover:text-zinc-100 transition-colors">Integrations</a>
            <a href="#pricing" className="hover:text-zinc-100 transition-colors">Pricing</a>
            <Link href="/docs" className="hover:text-zinc-100 transition-colors">Docs</Link>
            <a href="/api/openapi.json" className="hidden sm:inline hover:text-zinc-100 transition-colors">API</a>
            <Link href="/login" className="hover:text-zinc-100 transition-colors">Sign in</Link>
            <Link
              href="/start"
              className="rounded-md bg-zinc-100 text-zinc-950 px-3 py-1.5 text-sm font-medium hover:bg-white transition-colors"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-zinc-900">
        {/* Soft dark vignette for depth behind the type */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_55%,rgba(9,9,11,0.88)_0%,rgba(9,9,11,0.5)_45%,transparent_82%)]"
          aria-hidden="true"
        />

        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 flex flex-col items-center text-center">
          <p className="text-xs font-mono uppercase tracking-[0.25em] text-emerald-400/80">
            Authorize · Protect · Govern
          </p>

          {/* The Sanction access card — one of the keys from the keymaster */}
          <div className="card-perspective relative mt-12 mb-14">
            <div className="absolute -inset-8 rounded-[2.5rem] bg-emerald-500/20 blur-3xl" aria-hidden="true" />
            <div
              className="card-3d relative aspect-[1.586/1] w-[20rem] sm:w-[24rem] overflow-hidden rounded-2xl border border-emerald-400/25 p-5 sm:p-6 text-left shadow-2xl shadow-emerald-950/50"
              style={{
                background:
                  "linear-gradient(135deg, #18181b 0%, #0f1f1a 45%, #052e25 100%)",
              }}
            >
              {/* embossed route texture */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(115deg, #fff 0 1px, transparent 1px 22px)",
                }}
                aria-hidden="true"
              />
              <div className="relative flex h-full flex-col justify-between">
                {/* top row */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-sm sm:text-base font-semibold tracking-[0.22em] text-zinc-100">SANCTION</p>
                    <p className="mt-1 text-[9px] font-mono uppercase tracking-[0.22em] text-emerald-400/80">
                      Agent Access Key
                    </p>
                  </div>
                  {/* contactless / tap-in */}
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 8a6 6 0 0 1 0 8" />
                    <path d="M11 6a9 9 0 0 1 0 12" />
                    <path d="M14 4a12 12 0 0 1 0 16" />
                  </svg>
                </div>

                {/* chip + number */}
                <div>
                  <span className="relative inline-block overflow-hidden rounded-[5px]">
                    <svg viewBox="0 0 48 36" className="block h-7 w-10">
                      <defs>
                        <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor="#fde68a" />
                          <stop offset="0.5" stopColor="#f59e0b" />
                          <stop offset="1" stopColor="#fcd34d" />
                        </linearGradient>
                      </defs>
                      <rect x="0.5" y="0.5" width="47" height="35" rx="5" fill="url(#chip)" stroke="rgba(0,0,0,0.25)" />
                      <g stroke="rgba(120,90,10,0.55)" strokeWidth="1.1" fill="none">
                        <line x1="0" y1="12" x2="48" y2="12" />
                        <line x1="0" y1="24" x2="48" y2="24" />
                        <line x1="16" y1="0" x2="16" y2="36" />
                        <line x1="32" y1="0" x2="32" y2="36" />
                        <rect x="16" y="12" width="16" height="12" />
                      </g>
                    </svg>
                    <span className="chip-shimmer" aria-hidden="true" />
                  </span>
                  <p className="mt-3 font-mono text-sm sm:text-base tracking-[0.18em] text-zinc-200">
                    PXY · •••• · •••• · AGNT
                  </p>
                  <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                    Clearance ◆ 5 &nbsp;·&nbsp; Valid Thru ∞
                  </p>
                </div>

                {/* bottom row */}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-500">Cardholder</p>
                    <p className="text-xs font-medium tracking-wide text-zinc-200">AUTONOMOUS AGENT</p>
                  </div>
                  {/* holographic key */}
                  <div
                    className="h-8 w-8 rounded-full opacity-80"
                    style={{
                      background:
                        "conic-gradient(from 140deg, #34d399, #22d3ee, #a78bfa, #f59e0b, #34d399)",
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Company wordmark — large */}
          <h1 className="text-balance">
            <span className="block font-display bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-6xl sm:text-8xl font-semibold tracking-tight text-transparent">
              Sanction
            </span>
            <span className="mt-4 block font-display text-2xl sm:text-4xl font-semibold tracking-tight text-zinc-200">
              The authorization layer for AI agents that act.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-xl font-medium text-zinc-100 text-pretty">
            Don&apos;t give your agent your credit card. Give it a Sanction key.
          </p>
          <p className="mt-3 max-w-2xl text-lg text-zinc-400 text-pretty">
            Track and cap what every agent spends, and approve, gate, or deny each action before the
            money moves or a secret is used. One key governs spend and access.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <a
              href="/start"
              className="rounded-md bg-emerald-500 text-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition-colors"
            >
              Start free
            </a>
            <a
              href="/dashboard/spend"
              className="rounded-md border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors"
            >
              See it live →
            </a>
          </div>
          <p className="mt-5 text-xs text-zinc-600 font-mono">
            MCP · AWS Bedrock Action Groups · REST
          </p>
        </div>
      </section>

      {/* Pillars */}
      <section id="pillars" className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Three pillars</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-5">
          {pillars.map((p) => (
            <div key={p.name} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <p className="text-xs font-mono uppercase tracking-widest text-emerald-400/80">{p.tag}</p>
              <h3 className="mt-2 text-lg font-semibold">{p.name}</h3>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{p.desc}</p>
              <ul className="mt-4 space-y-1.5">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">How it works</h2>
            <h3 className="mt-3 font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              Three steps to a governed agent.
            </h3>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              Sanction sits between your agent and the world. You set the rules once; it enforces
              them on every call — and keeps a receipt.
            </p>
          </div>

          {/* Numbered steps */}
          <div className="relative mt-16">
            <div
              className="hidden md:block absolute top-8 left-[16.6%] right-[16.6%] h-px bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0"
              aria-hidden="true"
            />
            <div className="grid md:grid-cols-3 gap-12 md:gap-8">
              {steps.map((s) => (
                <div key={s.n} className="relative flex flex-col items-center text-center">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-zinc-950 font-display text-2xl font-semibold text-emerald-300 shadow-[0_0_30px_-8px_rgba(16,185,129,0.6)]">
                    {s.n}
                  </div>
                  <h4 className="mt-5 font-display text-lg font-semibold text-zinc-100">{s.title}</h4>
                  <p className="mt-2 max-w-xs text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
                  <code className="mt-3 text-[11px] font-mono text-emerald-400/70">{s.meta}</code>
                </div>
              ))}
            </div>
          </div>

          {/* Decision engine + code */}
          <div className="mt-16 grid lg:grid-cols-2 gap-6 items-stretch">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">The decision engine</p>
              <p className="mt-2 text-sm text-zinc-400">Every authorize call returns one of three outcomes:</p>
              <div className="mt-5 space-y-4">
                {outcomes.map((o) => (
                  <div key={o.label} className="flex gap-3">
                    <span className={`shrink-0 self-start rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass[o.tone]}`}>
                      {o.label}
                    </span>
                    <p className="text-sm text-zinc-400 leading-relaxed">{o.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <span className="ml-2 text-xs font-mono text-zinc-500">authorize.sh</span>
              </div>
              <pre className="p-4 text-xs leading-relaxed font-mono text-zinc-300 overflow-x-auto">
                <code>{authorizeSnippet}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Use cases</h2>
            <h3 className="mt-3 font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              What it looks like in practice.
            </h3>
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-6">
            {useCases.map((u) => (
              <div key={u.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
                <p className="text-xs font-mono uppercase tracking-widest text-emerald-400/80">{u.tag}</p>
                <h4 className="mt-3 font-display text-xl font-semibold text-zinc-100">{u.title}</h4>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{u.scenario}</p>
                <div className="mt-5 border-t border-zinc-800 pt-5">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">With Sanction</p>
                  <ul className="mt-3 space-y-2.5">
                    {u.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm text-zinc-300">
                        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                        </svg>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section id="integrations" className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Integrations</h2>
            <h3 className="mt-3 font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              Governs your whole agent stack.
            </h3>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              Sanction is provider-agnostic. Meter model spend through the gateway, run a spend
              authorization before an agent pays, and vault scoped credentials for the tools it uses.
              These are the providers, rails, and tools your agents work with — one key governs across them.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800">
            {integrations.map((i) => (
              <div
                key={i.title}
                title={i.title}
                className="group flex flex-col items-center justify-center gap-2 bg-zinc-950 px-3 py-6 transition-colors hover:bg-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-zinc-500 transition-colors group-hover:text-zinc-100" fill="currentColor" aria-hidden="true">
                  <path d={i.path} />
                </svg>
                <span className="text-center text-[10px] leading-tight text-zinc-600 transition-colors group-hover:text-zinc-400">
                  {i.title}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-xs text-zinc-600">
            + any REST API — via MCP, AWS Bedrock Action Groups, or direct calls.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="text-center">
          <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Pricing</h2>
          <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">Free while we grow.</h3>
          <p className="mt-3 text-zinc-400">Unlimited agents, no card. The whole platform is free today — paid plans for teams and enterprises come later.</p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-xl border p-6 ${
                t.highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-950">
                  Start here
                </span>
              )}
              <h4 className="text-sm font-semibold text-zinc-200">{t.name}</h4>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{t.price}</span>
                {t.cadence && <span className="text-sm text-zinc-500">{t.cadence}</span>}
              </div>
              <p className="mt-2 text-sm text-zinc-500">{t.blurb}</p>
              <ul className="mt-5 space-y-2 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={t.href}
                className={`mt-6 rounded-md px-4 py-2 text-sm font-medium text-center transition-colors ${
                  t.highlight
                    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                    : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Stay in the loop — awareness-stage capture for visitors not ready to wire an agent yet */}
      <section className="border-t border-zinc-900">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
            Not ready to wire up an agent?
          </h2>
          <p className="mt-3 text-zinc-400">
            Get launch updates and early access as we ship. One email when it matters — no spam.
          </p>
          <div className="mt-7 max-w-md mx-auto text-left">
            <LeadCapture source="landing" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <div>
            <p className="font-display font-semibold text-zinc-300">Sanction</p>
            <p className="text-xs">Authorize. Protect. Govern.</p>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="hover:text-zinc-200 transition-colors">Dashboard</Link>
            <Link href="/ethical-ai" className="hover:text-zinc-200 transition-colors">Ethical AI</Link>
            <a href="/api/openapi.json" className="hover:text-zinc-200 transition-colors">API</a>
            <a href="https://www.npmjs.com/package/sanction-mcp" className="hover:text-zinc-200 transition-colors">MCP</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
