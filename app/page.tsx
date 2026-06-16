import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Sanction — Trust & governance for autonomous agents",
  description:
    "The trust layer for autonomous AI agents. Spend authorization, an encrypted credential vault, and clearance levels — the financial identity that travels with your agent.",
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
    cadence: "forever",
    blurb: "For a single agent finding its feet.",
    features: ["1 wallet, 1 agent", "100 authorizations / mo", "Token usage logging", "Community support"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$19",
    cadence: "/ month",
    blurb: "For builders running real agents.",
    features: ["3 agents", "10,000 authorizations / mo", "Credential vault (AES-256)", "Execution JWTs", "Email support"],
    cta: "Start Pro",
    highlight: true,
  },
  {
    name: "Team",
    price: "$49",
    cadence: "/ month",
    blurb: "For fleets that need governance.",
    features: ["10 agents", "Unlimited authorizations", "Clearance levels 1–5", "Audit log export", "Priority support"],
    cta: "Start Team",
    highlight: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    blurb: "For regulated, high-volume deployments.",
    features: ["Unlimited agents", "SSO & custom clearance domains", "On-prem / VPC deployment", "SLA & dedicated support"],
    cta: "Contact sales",
    highlight: false,
  },
]

const authorizeSnippet = `curl -X POST https://proxy-ai-three.vercel.app/api/v1/authorize \\
  -H "x-api-key: pxy_••••" \\
  -H "content-type: application/json" \\
  -d '{
    "merchant": "openai",
    "amount_usd": 12.50,
    "category": "services"
  }'

# → { "decision": "approved", "remaining_daily_usd": 37.50 }`

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            Sanction
          </Link>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <a href="#pillars" className="hidden sm:inline hover:text-zinc-100 transition-colors">Pillars</a>
            <a href="#how" className="hidden sm:inline hover:text-zinc-100 transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-zinc-100 transition-colors">Pricing</a>
            <a href="/api/openapi.json" className="hidden sm:inline hover:text-zinc-100 transition-colors">API</a>
            <Link
              href="/dashboard"
              className="rounded-md bg-zinc-100 text-zinc-950 px-3 py-1.5 text-sm font-medium hover:bg-white transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400/80">
          Authorize · Protect · Govern
        </p>
        <h1 className="mt-5 text-4xl sm:text-6xl font-semibold tracking-tight text-balance">
          The trust layer for
          <br className="hidden sm:block" /> autonomous agents.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-zinc-400 text-pretty">
          Agents need agency. Sanction is the financial identity that travels with your agent —
          a wallet, a credential vault, and a clearance system. Before an agent spends money,
          touches a secret, or acts in a sensitive domain, it asks Sanction. Sanction decides,
          logs, and audits everything.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <a
            href="#pricing"
            className="rounded-md bg-emerald-500 text-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition-colors"
          >
            Get started — free
          </a>
          <a
            href="/api/openapi.json"
            className="rounded-md border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            View the API
          </a>
        </div>
        <p className="mt-5 text-xs text-zinc-600 font-mono">
          MCP · AWS Bedrock Action Groups · REST
        </p>
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
      <section id="how" className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">How it works</h2>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">One call before money moves.</h3>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              Your agent calls <span className="font-mono text-zinc-300">/authorize</span> before it spends.
              Sanction checks the wallet&apos;s policy — limits, categories, clearance — and returns a decision
              in milliseconds. Approvals are logged. Escalations wait for a human. Denials never reach the merchant.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                ["1", "Register an agent", "Issue a scoped pxy_ API key per agent."],
                ["2", "Set a policy", "Daily and per-transaction budgets, allowed categories."],
                ["3", "Authorize spend", "Auto-approve, escalate, or deny — every call audited."],
              ].map(([n, t, d]) => (
                <li key={n} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-xs font-mono text-zinc-400">
                    {n}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{t}</p>
                    <p className="text-sm text-zinc-500">{d}</p>
                  </div>
                </li>
              ))}
            </ul>
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
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="text-center">
          <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Pricing</h2>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight">Trust through limits.</h3>
          <p className="mt-3 text-zinc-400">Start free. Scale when your fleet does.</p>
        </div>
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-xl border p-6 ${
                t.highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-950">
                  Most popular
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
                href="/dashboard"
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

      {/* Footer */}
      <footer className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <div>
            <p className="font-semibold text-zinc-300">Sanction</p>
            <p className="text-xs">Authorize. Protect. Govern.</p>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="hover:text-zinc-200 transition-colors">Dashboard</Link>
            <a href="/api/openapi.json" className="hover:text-zinc-200 transition-colors">API</a>
            <a href="https://www.npmjs.com/package/sanction-mcp" className="hover:text-zinc-200 transition-colors">MCP</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
