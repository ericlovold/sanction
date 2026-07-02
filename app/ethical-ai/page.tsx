import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Sanction Ethical AI — ethics review and governance design for autonomous systems",
  description:
    "Ethics review, moral-risk analysis, and governance package design for teams deploying autonomous systems, with a local Moral Intention Analyst agent guided by Dr. A.C. Ping.",
}

const BOOK_URL = "mailto:eric@getsanction.com?subject=Ethics%20work%20session"
const MIA_URL = "/mia-local"

const offers = [
  {
    name: "Ethical AI Risk Review",
    buyer: "Founders, agencies, product teams",
    deliverable:
      "A moral-risk map of your autonomous system: stakeholder analysis, red-flag assessment, and the risks being rationalized away — before they ship.",
  },
  {
    name: "Moral Intention Workshop",
    buyer: "Leadership and teams",
    deliverable:
      "A facilitated work session with Dr. Ping and Eric. Surface what your system optimizes for, where intention and incentive diverge, and what obligations remain with the people affected by it.",
  },
  {
    name: "Governance Design Package",
    buyer: "Teams shipping agents",
    deliverable:
      "The review, turned operational: Sanction policies, human approval workflows, escalation thresholds, one-use grants, and the audit artifacts your clients and board can inspect.",
  },
  {
    name: "Ongoing Ethics Review",
    buyer: "Enterprise and regulated teams",
    deliverable:
      "Monthly or quarterly review against your live audit trail: drift detection, new-capability assessment, and governance updates as your agents take on more.",
  },
]

const bridge = [
  {
    tag: "Upstream — the analysis",
    title: "MIA identifies the risk",
    desc:
      "The ethics layer, led by Dr. Ping (AC Ping) and grounded in the MIA constitution: what should the policy be, which risks are being rationalized, what red flags exist, and which decisions must never be made without a human.",
    points: ["Moral-risk map & stakeholder analysis", "Red-flag and rationalization assessment", "The human approval boundaries your system needs"],
  },
  {
    tag: "Downstream — the enforcement",
    title: "Sanction makes it enforceable",
    desc:
      "The findings become operational controls on the platform you already saw on the front page: authorization policies, escalation to a human over the line, one-use grants from approvals, and a decision log for every action.",
    points: ["Spend, tool, and provisioning policies", "Human approval workflows & escalation thresholds", "Grants, audit trail, drift review"],
  },
]

export default function EthicalAI() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-display font-semibold tracking-tight">
            Sanction
          </Link>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100 transition-colors">Platform</Link>
            <Link href={MIA_URL} className="hover:text-zinc-100 transition-colors">MIA Local</Link>
            <Link href="/docs" className="hover:text-zinc-100 transition-colors">Docs</Link>
            <Link href="/login" className="hover:text-zinc-100 transition-colors">Sign in</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-sm font-mono uppercase tracking-widest text-zinc-500">Sanction Ethical AI</p>
        <h1 className="mt-5 font-display text-4xl sm:text-6xl font-semibold tracking-tight text-balance bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
          Ethical analysis becomes enforceable authorization.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-xl font-medium text-zinc-100 text-pretty">
          Ethics review, moral-risk analysis, and governance package design for teams deploying autonomous systems.
        </p>
        <p className="mt-3 max-w-2xl mx-auto text-lg text-zinc-400 text-pretty">
          Philosopher-led work sessions identify the moral and organizational risk.
          Sanction turns that analysis into policy, approvals, grants, logs, and operational controls.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <a
            href={BOOK_URL}
            className="rounded-md bg-emerald-500 text-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition-colors"
          >
            Book an ethics work session
          </a>
          <Link
            href="/"
            className="rounded-md border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            See the platform
          </Link>
        </div>
      </section>

      {/* The bridge */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">The bridge</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {bridge.map((b) => (
            <div key={b.title} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">{b.tag}</p>
              <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-zinc-100">{b.title}</h3>
              <p className="mt-3 text-sm text-zinc-400">{b.desc}</p>
              <ul className="mt-5 space-y-2">
                {b.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-zinc-500 max-w-2xl mx-auto">
          Most ethics reviews end as a PDF. This one ends as running policy: approval thresholds a
          human owns, grants that expire, and an audit trail that shows the review is being
          followed, not filed.
        </p>
      </section>

      {/* MIA Local */}
      <section className="border-t border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-16 grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
          <div>
            <p className="text-sm font-mono uppercase tracking-widest text-zinc-500">MIA Local</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-zinc-100">
              A free, airgapped ethics agent for local moral reflection.
            </h2>
            <p className="mt-4 text-zinc-400 text-pretty">
              The Moral Intention Analyst is being prepared as a standalone local agent guided by
              Dr. A.C. Ping&apos;s frameworks. It is designed for private ethics work, persistent
              memory, and human-reviewed growth without sending sensitive dilemmas to the cloud.
            </p>
            <Link
              href={MIA_URL}
              className="mt-6 inline-flex rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
            >
              View MIA Local
            </Link>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {["Local model", "Private memory", "Reviewed doctrine", "Sanction policies"].map((label) => (
                <div key={label} className="rounded-md border border-zinc-800 bg-zinc-900/45 p-4">
                  <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">{label}</p>
                  <div className="mt-4 h-1.5 rounded-full bg-zinc-800">
                    <div className="h-full w-2/3 rounded-full bg-emerald-500" />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm text-zinc-500">
              MIA helps define the boundary. Sanction enforces it.
            </p>
          </div>
        </div>
      </section>

      {/* Offers */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="text-center">
          <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Engagements</h2>
          <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">Four ways in.</h3>
          <p className="mt-3 text-zinc-400">Start with a review or a work session. Leave with governance your agents can run under.</p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {offers.map((o) => (
            <div key={o.name} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h4 className="text-sm font-semibold text-zinc-200">{o.name}</h4>
              <p className="mt-1 text-xs font-mono uppercase tracking-wide text-zinc-600">{o.buyer}</p>
              <p className="mt-4 flex-1 text-sm text-zinc-400">{o.deliverable}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who leads it */}
      <section className="border-t border-zinc-900">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h2 className="text-sm font-mono uppercase tracking-widest text-zinc-500">Who leads it</h2>
          <p className="mt-5 text-lg text-zinc-300 text-pretty">
            The ethics work is led by <span className="text-zinc-100 font-medium">Dr. Ping</span> (AC Ping),
            whose MIA framework grounds the analysis, together with{" "}
            <span className="text-zinc-100 font-medium">Eric Lovold</span>, who builds the enforcement
            layer. One session, both halves: the philosophical authority and the operational system.
          </p>
          <a
            href={BOOK_URL}
            className="mt-8 inline-flex rounded-md bg-emerald-500 text-zinc-950 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition-colors"
          >
            Book an ethics work session
          </a>
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
            <Link href="/" className="hover:text-zinc-200 transition-colors">Platform</Link>
            <Link href={MIA_URL} className="hover:text-zinc-200 transition-colors">MIA Local</Link>
            <Link href="/docs" className="hover:text-zinc-200 transition-colors">Docs</Link>
            <a href="/api/openapi.json" className="hover:text-zinc-200 transition-colors">API</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
