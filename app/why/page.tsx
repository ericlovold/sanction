import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"

export const metadata: Metadata = {
  title: "Why Sanction — why authorization is its own system",
  description:
    "The philosophy behind Sanction: identity isn't authorization, prompts aren't policy, observability isn't enforcement, approval is not execution, evidence requires replay, and governance should travel with the agent.",
}

// The canonical philosophy page — six claims, each one sentence of thesis and
// a short defense. This is the document everything else links back to. Voice
// belongs to Eric; edit freely, the structure is the point.

const CLAIMS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Identity isn't authorization.",
    body: (
      <>
        Knowing <em>who</em> an agent is says nothing about <em>what it may do right now</em>. Identity is a
        prerequisite, and it belongs upstream — Entra, SPIFFE, agent cards, your issuer of record. Authorization is
        a separate question asked on every action, against live policy and live budget state. Sanction consumes
        canonical identity and mints governed runtime identity; it never becomes your identity provider, and your
        identity provider never becomes your policy engine.
      </>
    ),
  },
  {
    title: "Prompts aren't policy.",
    body: (
      <>
        &ldquo;Please don&rsquo;t spend more than $200&rdquo; is a suggestion to a stochastic process. A policy is a
        limit that holds when the model is confused, jailbroken, or simply wrong — because it is enforced outside
        the model, by a system the model cannot argue with. If your guardrail lives in the system prompt, your
        guardrail is an opinion held by the thing being guarded.
      </>
    ),
  },
  {
    title: "Observability isn't enforcement.",
    body: (
      <>
        A dashboard that shows you the overspend after it cleared is a record of a decision nobody made. Watching
        agents is necessary and insufficient: the check has to happen <em>before</em> the action, atomically with
        the budget debit, or sibling agents will race past the cap between your metric and your alert. Sanction sits
        in the request path on purpose.
      </>
    ),
  },
  {
    title: "Approval is not execution.",
    body: (
      <>
        A human saying yes should not hand the agent a blank check — it should mint exactly one authorization.
        In Sanction, approval produces a single-use, expiring grant bound to the request that escalated. The agent
        redeems it once, the evidence records it, and the authority dies with the use. Standing permission is how
        one good approval becomes a thousand unreviewed actions.
      </>
    ),
  },
  {
    title: "Evidence requires replay.",
    body: (
      <>
        A log line says what happened; it cannot prove <em>why</em>. Proof requires determinism: pure rules, an
        immutable revision for every policy edit, and the exact context each decision evaluated — stored. Ask
        &ldquo;why was this denied?&rdquo; and Sanction re-runs the same rules over the same context and shows the
        outcome reproduces. The same property runs forward: replay last week under a candidate policy before you
        set it. If a decision can&rsquo;t be replayed, it can&rsquo;t be audited — only narrated.
      </>
    ),
  },
  {
    title: "Governance should travel with the agent.",
    body: (
      <>
        Platform vendors govern agents inside their own walls — and agents don&rsquo;t stay inside walls. The same
        policy has to answer over REST, MCP, an SDK, a Bedrock action group, an LLM gateway, and the open AuthZEN
        standard, so that switching runtimes never means shedding governance. Authorization that only works in one
        ecosystem isn&rsquo;t governance; it&rsquo;s a feature of someone else&rsquo;s product.
      </>
    ),
  },
]

export default function Why() {
  return (
    <div className="min-h-screen">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Why Sanction</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Why authorization is its own system
        </h1>
        <p className="mt-3 text-lg text-zinc-400 leading-relaxed">
          Autonomous software acts. Everything else in the stack — identity, prompts, observability, human sign-off
          — gets treated as if it were the control. None of them are. These are the six claims Sanction is built
          on.
        </p>

        <section className="mt-12 space-y-10">
          {CLAIMS.map((c, i) => (
            <div key={c.title}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-100">
                <span className="mr-3 text-sm font-mono text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                {c.title}
              </h2>
              <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-400">{c.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">The consequence</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Take the six claims together and the conclusion is structural: authorization has to be a system of its
            own — deterministic at the core, atomic where money and state move, evidenced everywhere, and
            independent of any platform the agent happens to run on. That system is what Sanction is.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/architecture" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-zinc-200 transition-colors hover:border-zinc-700">
              See the architecture →
            </Link>
            <Link href="/docs/quickstart" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-zinc-200 transition-colors hover:border-zinc-700">
              Make a governed call →
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
