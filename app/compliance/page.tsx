import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"

export const metadata: Metadata = {
  title: "Sanction & the EU AI Act — evidence oversight for your AI agents",
  description:
    "Aug 2, 2026: the EU AI Act's enforcement goes live. Sanction is the evidence and human-oversight layer around the agents you operate — signed audit logs (Art 12), decision transparency (Art 13), and recorded human approvals (Art 14). Pull one Article-framed, verifiable evidence bundle. Evidence support, not legal advice.",
}

const CROSSWALK: { art: string; obligation: string; surface: ReactNode }[] = [
  {
    art: "Art 12",
    obligation: "Automatic record-keeping — log events over the system's lifetime",
    surface: (
      <>
        Every governed decision, token log, and secret access is persisted, then pulled as a{" "}
        <strong className="text-zinc-200">signed, hash-chained export</strong>. Altering, dropping, or reordering any
        entry breaks the chain — and anyone can re-verify it.
      </>
    ),
  },
  {
    art: "Art 13",
    obligation: "Transparency — decisions that can be interpreted and reproduced",
    surface: (
      <>
        Every decision carries a stable outcome code and the exact{" "}
        <strong className="text-zinc-200">policy revision</strong> it ran under, and can be replayed from its stored
        context to reproduce the result.
      </>
    ),
  },
  {
    art: "Art 14",
    obligation: "Human oversight — a person can intervene and stop the system",
    surface: (
      <>
        Over-threshold actions escalate to a human whose approval mints a single-use grant; the record captures{" "}
        <strong className="text-zinc-200">who</strong> decided, <strong className="text-zinc-200">when</strong>, and{" "}
        <strong className="text-zinc-200">why</strong>. The freeze kill-switch halts an agent — or a whole pool —
        instantly.
      </>
    ),
  },
]

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 text-[12.5px] leading-relaxed text-zinc-300">
      <code>{children}</code>
    </pre>
  )
}

const exportSnippet = `# One signed, Article-framed evidence bundle for a whole org
curl "https://getsanction.com/api/v1/audit/export?wallet_id=WALLET_ID\\
&scope=subtree&framing=eu-ai-act" \\
  -H "x-mgmt-key: sk_your_management_key"
# → the signed export + an ai_act block: Article mapping, retention,
#   decision counts (incl. how many a named human resolved), signed head`

const verifySnippet = `# Prove it wasn't altered afterward — no trust in us required
curl -X POST "https://getsanction.com/api/v1/audit/verify" \\
  -H "x-mgmt-key: sk_your_management_key" --data-binary @export.json
# → { "valid": true, "chain_valid": true, "signature_valid": true }`

export default function Compliance() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">EU AI Act</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Evidence oversight for your AI agents — before Aug 2
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-zinc-400">
          On <strong className="text-zinc-200">2 August 2026</strong> the EU AI Act becomes fully applicable and
          enforcement — including GPAI fines — goes live. Sanction is the evidence and human-oversight layer you put
          around the agents you operate, so you can <em>demonstrate</em> the record-keeping, transparency, and
          oversight the Act expects.
        </p>

        {/* Honest framing */}
        <section className="mt-8 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-5">
          <p className="text-sm leading-relaxed text-zinc-300">
            <strong className="text-amber-300">Straight about the timeline:</strong> the May 2026 Digital Omnibus
            pushed the <em>high-risk</em> obligations to 2027–2028. Aug 2, 2026 is the enforcement-goes-live and GPAI
            milestone — and the moment every team deploying AI is asked &ldquo;can you evidence oversight and
            logging?&rdquo; Sanction is how you answer with proof, not a slide.
          </p>
        </section>

        {/* Crosswalk */}
        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold tracking-tight">What Sanction gives you</h2>
          <p className="mt-2 text-zinc-400">Three of the Act&rsquo;s operator obligations, and the surface that evidences each.</p>
          <div className="mt-6 space-y-5">
            {CROSSWALK.map((row) => (
              <div key={row.art} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-400">
                    {row.art}
                  </span>
                  <span className="font-display text-lg font-semibold tracking-tight text-zinc-100">{row.obligation}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">{row.surface}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The evidence bundle */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Pull the evidence</h2>
          <p className="mt-2 text-zinc-400">
            One call produces a tamper-evident, Article-framed bundle for a wallet — or a whole org. Anyone can
            re-verify it independently; the framing rides alongside the signed chain and never alters it.
          </p>
          <Code>{exportSnippet}</Code>
          <Code>{verifySnippet}</Code>
        </section>

        {/* Retention */}
        <section className="mt-12 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">Append-only by construction</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            The audit trail is append-only — governed decisions, token logs, and secret-access records are never
            modified or deleted after write. There is no purge job and no mutation path. An export is a signed
            snapshot; the records remain for the life of the wallet.
          </p>
        </section>

        {/* Honest boundary */}
        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold tracking-tight">The honest boundary</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">
            Sanction gives you <strong className="text-zinc-200">evidence to support</strong> Art 12/13/14 obligations
            for the agents you run. It is not a compliance certification, a conformity assessment, or legal advice —
            and it isn&rsquo;t itself a high-risk AI system. Talk to your own counsel about which obligations apply to
            your systems. We say &ldquo;helps you demonstrate,&rdquo; never &ldquo;makes you compliant.&rdquo;
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link href="/docs/eu-ai-act" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-zinc-200 transition-colors hover:border-zinc-700">
              The full crosswalk →
            </Link>
            <Link href="/dashboard/audit" className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-zinc-200 transition-colors hover:border-zinc-700">
              See a live audit trail →
            </Link>
            <Link href="/start" className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              Start free →
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
