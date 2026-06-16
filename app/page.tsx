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
          <Link href="/" className="font-display font-semibold tracking-tight">
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
      <section className="relative overflow-hidden border-b border-zinc-900">
        {/* Neon interaction highway */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <svg className="h-full w-full" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="neon" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1200" y2="0">
                <stop offset="0" stopColor="#10b981" stopOpacity="0" />
                <stop offset="0.18" stopColor="#10b981" stopOpacity="0.6" />
                <stop offset="0.5" stopColor="#22d3ee" stopOpacity="0.6" />
                <stop offset="0.82" stopColor="#10b981" stopOpacity="0.6" />
                <stop offset="1" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g fill="none" stroke="url(#neon)" strokeWidth="1.4" strokeLinecap="round">
              <path className="neon-line" style={{ animationDelay: "0s" }} d="M-60,90 C 250,40 460,180 700,120 S 1120,60 1260,140" />
              <path className="neon-line" style={{ animationDelay: "1.1s" }} d="M-60,210 C 200,270 520,150 770,235 S 1080,300 1260,225" />
              <path className="neon-line" style={{ animationDelay: "2.3s" }} d="M-60,330 C 320,270 520,420 800,335 S 1120,275 1260,360" />
              <path className="neon-line" style={{ animationDelay: "0.6s" }} d="M-60,450 C 250,520 500,380 740,455 S 1100,520 1260,440" />
              <path className="neon-line" style={{ animationDelay: "1.7s" }} d="M-60,540 C 300,500 540,580 820,520 S 1120,470 1260,545" />
            </g>
            <g fill="#34d399">
              <circle className="neon-node" style={{ animationDelay: "0.4s" }} cx="700" cy="120" r="2.6" />
              <circle className="neon-node" style={{ animationDelay: "1.5s" }} cx="770" cy="235" r="2.6" />
              <circle className="neon-node" style={{ animationDelay: "2.6s" }} cx="800" cy="335" r="2.6" />
              <circle className="neon-node" style={{ animationDelay: "0.9s" }} cx="740" cy="455" r="2.6" />
            </g>
          </svg>
        </div>
        {/* Dark scrim behind the type so it reads cleanly over the highway */}
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
              <div className="card-sheen" aria-hidden="true" />

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
                  <svg viewBox="0 0 48 36" className="h-7 w-10">
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
              The trust layer for autonomous agents.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg text-zinc-300 text-pretty">
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
      <section id="how" className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">How it works</h2>
            <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">One call before money moves.</h3>
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
          <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">Trust through limits.</h3>
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
            <p className="font-display font-semibold text-zinc-300">Sanction</p>
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
