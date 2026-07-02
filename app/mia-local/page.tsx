import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Moral Intention Analyst Local - free, airgapped ethical AI agent",
  description:
    "Moral Intention Analyst Local is a planned free, airgapped ethics agent guided by Dr. A.C. Ping's moral intention frameworks and designed for private, persistent local memory.",
}

const BOOK_URL = "mailto:eric@getsanction.com?subject=Moral%20Intention%20Analyst%20Local"

const principles = [
  {
    name: "Airgapped by default",
    text: "Runs on local hardware with no cloud account required. Sensitive dilemmas stay on the machine where they are discussed.",
  },
  {
    name: "Persistent memory",
    text: "Keeps local context across sessions so ethical analysis can deepen over time instead of starting from zero.",
  },
  {
    name: "Reviewed doctrine",
    text: "Dr. Ping's canonical frameworks remain separate from session memory. New doctrine should be human-reviewed before it becomes part of the product.",
  },
  {
    name: "Free local release",
    text: "The local agent is intended to be free. Commercial work lives around workshops, ethics packages, hardware, and Sanction implementation.",
  },
]

const memoryLayers = [
  ["Frameworks", "Moral Intention Analyst Constitution, Moral Intention Theory, Causal Factor Model, and Red Flag Taxonomy."],
  ["Session memory", "Local case notes, recurring concerns, stakeholder maps, and user-specific context."],
  ["Reflections", "Generated observations, neutralization patterns, and unresolved moral tensions."],
  ["Controls", "Export, delete, reset, and future signed update bundles for reviewed knowledge."],
]

const launchSteps = [
  "Local CLI or desktop web UI on the Mini",
  "Local model through Ollama or llama.cpp",
  "SQLite memory store plus local retrieval index",
  "Moral Intention Analyst framework pack loaded as reviewed reference material",
  "Manual update bundles before any networked sync",
]

export default function MIALocalPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">
            Sanction
          </Link>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/ethical-ai" className="transition-colors hover:text-zinc-100">Ethical AI</Link>
            <Link href="/docs" className="transition-colors hover:text-zinc-100">Docs</Link>
            <Link href="/login" className="transition-colors hover:text-zinc-100">Sign in</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
          <div>
            <p className="font-mono text-sm uppercase tracking-widest text-zinc-500">Moral Intention Analyst Local</p>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-zinc-100 sm:text-6xl">
              A local ethics agent for private moral reasoning.
            </h1>
            <p className="mt-6 max-w-2xl text-xl font-medium text-zinc-200">
              Moral Intention Analyst Local is being prepared as a free, airgapped agent guided by Dr. A.C. Ping&apos;s moral intention work.
            </p>
            <p className="mt-4 max-w-2xl text-zinc-400">
              It is for sensitive ethical reflection: autonomous-system risk, institutional incentives,
              stakeholder harm, rationalization, and the human boundaries that should become enforceable policy.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={BOOK_URL}
                className="rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
              >
                Talk about Moral Intention Analyst
              </a>
              <Link
                href="/ethical-ai"
                className="rounded-md border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                See Ethical AI
              </Link>
            </div>
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">Local memory stack</p>
                <span className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-500">offline</span>
              </div>
              <div className="mt-5 space-y-3">
                {memoryLayers.map(([name, text]) => (
                  <div key={name} className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-medium text-zinc-200">{name}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{text}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-4 text-sm text-zinc-500">
              Continues to learn means local memory deepens. It does not mean the moral framework silently rewrites itself.
            </p>
          </div>
        </section>

        <section className="border-t border-zinc-900">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {principles.map((principle) => (
                <div key={principle.name} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-5">
                  <h2 className="text-sm font-semibold text-zinc-100">{principle.name}</h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">{principle.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-900">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <p className="font-mono text-sm uppercase tracking-widest text-zinc-500">Product boundary</p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-zinc-100">
                Moral Intention Analyst defines the boundary. Sanction enforces it.
              </h2>
              <p className="mt-4 text-zinc-400">
                Moral Intention Analyst Local is not a replacement for judgment, legal review, or governance controls.
                It helps teams name moral risk and convert that work into boundaries Sanction can run.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                ["Moral Intention Analyst Local", "Moral intention analysis, neutralization detection, stakeholder reflection, case memory."],
                ["Sanction", "Authorization policies, approvals, grants, spend caps, credential controls, audit trail."],
                ["Ethical AI services", "Work sessions, articles, ethics packages, and implementation with Dr. Ping and Eric."],
              ].map(([name, text]) => (
                <div key={name} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-5">
                  <p className="text-sm font-semibold text-zinc-200">{name}</p>
                  <p className="mt-2 text-sm text-zinc-500">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-900">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <p className="text-center font-mono text-sm uppercase tracking-widest text-zinc-500">Launch path</p>
            <h2 className="mt-3 text-center font-display text-3xl font-semibold tracking-tight text-zinc-100">
              Start on the Mini. Graduate to dedicated hardware.
            </h2>
            <div className="mt-8 grid gap-3">
              {launchSteps.map((step, index) => (
                <div key={step} className="flex gap-4 rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-300">
                    {index + 1}
                  </span>
                  <p className="text-sm text-zinc-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-zinc-500 sm:flex-row">
          <div>
            <p className="font-display font-semibold text-zinc-300">Sanction</p>
            <p className="text-xs">Authorize. Protect. Govern.</p>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/" className="transition-colors hover:text-zinc-200">Platform</Link>
            <Link href="/ethical-ai" className="transition-colors hover:text-zinc-200">Ethical AI</Link>
            <Link href="/docs" className="transition-colors hover:text-zinc-200">Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
