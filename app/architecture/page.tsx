import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"

export const metadata: Metadata = {
  title: "How Sanction Works — the architecture",
  description:
    "The mental model in one page: identity stays upstream, every agent action passes through one atomic decision, and every decision leaves evidence you can replay.",
}

// The one-diagram page (teach the mental model before the quickstart).
// Everything here describes shipped behavior — if a claim outgrows the code,
// fix the page, not the reader's expectations.

function Arrow() {
  return (
    <div className="flex justify-center py-1 text-zinc-600" aria-hidden>
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path d="M8 0v16m0 0l-5-5m5 5l5-5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function Stage({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tracking-tight text-zinc-100">{title}</p>
      <div className="mt-1.5 text-sm leading-relaxed text-zinc-400">{children}</div>
    </div>
  )
}

const ENGINE_CHECKS = [
  ["Policy rules", "categories, per-transaction caps, tool and resource lists"],
  ["Budget state", "daily, monthly, and cascading subtree caps — read under lock"],
  ["Capability rules", "new skills, plugins, and APIs governed like money"],
  ["Escalation band", "amounts and actions that require a human"],
  ["Evidence", "the revision in force and the exact context evaluated, stored"],
] as const

const OUTCOMES = [
  {
    title: "Allow",
    tone: "border-emerald-900/60",
    body: "The action proceeds and the budget debits — in the same atomic evaluation, so sibling agents can't race past a shared cap.",
  },
  {
    title: "Escalate",
    tone: "border-amber-900/60",
    body: "A human approves wherever they are (dashboard, email, Slack). Approval mints a one-use, expiring grant the agent redeems on retry. Timeouts guarantee a terminal outcome.",
  },
  {
    title: "Deny",
    tone: "border-red-900/60",
    body: "Never a dead end: a machine code, the limit that fired with live values, when the answer changes, and — on budget denials — a signed offer to appeal to a human.",
  },
] as const

export default function Architecture() {
  return (
    <div className="min-h-screen">
      <DocsHeader />

      <main className="max-w-4xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Architecture</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">How Sanction works</h1>
        <p className="mt-3 max-w-2xl text-lg text-zinc-400">
          Sanction is an authorization plane, not a platform. Identity stays upstream, every agent action passes
          through one atomic decision, and every decision leaves evidence you can replay. One diagram:
        </p>

        {/* The diagram */}
        <section className="mt-10">
          <Stage label="Upstream" title="Identity — yours, not ours">
            Entra, SPIFFE, agent cards, plain API keys. Sanction consumes canonical identity and mints governed
            runtime identity (scoped keys, short-lived execution tokens) — never an identity of record.
          </Stage>

          <Arrow />

          <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">The decision</p>
            <p className="mt-1 font-display text-lg font-semibold tracking-tight text-zinc-100">
              One atomic evaluation
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
              Spend, tool call, credential access, provisioning, new capability — every action type rides the same
              pure rules engine. Policy, budgets, approvals, grants, ledger, and audit resolve together; there is no
              gap between &ldquo;allowed&rdquo; and &ldquo;paid for.&rdquo;
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {ENGINE_CHECKS.map(([name, desc], i) => (
                <li
                  key={name}
                  className={`rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 ${i === ENGINE_CHECKS.length - 1 ? "sm:col-span-2" : ""}`}
                >
                  <span className="text-sm font-medium text-zinc-200">{name}</span>
                  <span className="block text-xs text-zinc-500">{desc}</span>
                </li>
              ))}
            </ul>
          </div>

          <Arrow />

          <div className="grid gap-4 md:grid-cols-3">
            {OUTCOMES.map((o) => (
              <div key={o.title} className={`rounded-lg border ${o.tone} bg-zinc-900/50 p-5`}>
                <p className="font-display text-lg font-semibold tracking-tight text-zinc-100">{o.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{o.body}</p>
              </div>
            ))}
          </div>

          <Arrow />

          <Stage label="Downstream" title="Execution — wherever the agent runs">
            Sanction belongs to no platform. The same decision answers over REST, the TypeScript SDK, MCP, an AWS
            Bedrock action group, the LLM gateway, or the OpenID AuthZEN wire — so governance travels with the
            agent instead of living inside one vendor&rsquo;s walls.
          </Stage>
        </section>

        {/* Why it holds up */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Why this shape</h2>
          <p className="mt-2 text-sm text-zinc-500">
            The full argument — six claims, from &ldquo;identity isn&rsquo;t authorization&rdquo; to
            &ldquo;governance should travel with the agent&rdquo; — lives at{" "}
            <Link href="/why" className="text-emerald-400 hover:text-emerald-300">Why Sanction</Link>.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="text-sm font-medium text-zinc-100">Deterministic</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                Same request + same policy revision + same state ⇒ same decision. The rules are pure functions;
                the enforcement shell does the IO. That&rsquo;s what makes replay possible at all.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="text-sm font-medium text-zinc-100">Evidenced</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                Every policy edit becomes an immutable revision; every decision stores the revision in force and the
                exact context it evaluated. Ask{" "}
                <span className="text-zinc-300">&ldquo;why was this denied?&rdquo;</span> and get a replay that
                proves the answer.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="text-sm font-medium text-zinc-100">Explorable</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                The same purity runs time in both directions: dry-run a request before it happens, or replay last
                week under a candidate policy and see exactly which decisions would flip — before you change anything.
              </p>
            </div>
          </div>
        </section>

        {/* Where to go next */}
        <section className="mt-14 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">Now make it concrete</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <Link href="/docs/quickstart" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-zinc-200 transition-colors hover:border-zinc-700">
              Quickstart →
              <span className="block text-xs text-zinc-500">First governed call in five minutes.</span>
            </Link>
            <Link href="/docs" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-zinc-200 transition-colors hover:border-zinc-700">
              Integration guides →
              <span className="block text-xs text-zinc-500">Vercel AI SDK, LangChain, CrewAI, MCP.</span>
            </Link>
            <a href="/api/openapi.json" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-zinc-200 transition-colors hover:border-zinc-700">
              API reference →
              <span className="block text-xs text-zinc-500">OpenAPI 3.0, Bedrock-compatible.</span>
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}
