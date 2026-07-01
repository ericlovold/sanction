import type { Metadata } from "next"
import Link from "next/link"
import { LeadCapture } from "@/components/lead-capture"

export const metadata: Metadata = {
  title: "Sanction Local: Private AI that never leaves your building",
  description:
    "Governed, on-premise AI for small regulated practices: law firms, clinics, accounting, real estate, and manufacturing. Your data never leaves your hardware, and every action is logged for your assessor.",
}

const CONTACT = "mailto:eric@getsanction.com?subject=Sanction%20Local%20fit%20call"

const pillars = [
  {
    title: "Local",
    body: "Runs entirely on hardware you own. Open-weight models, retrieval over your own documents. No API calls to OpenAI or anyone else. Your data never leaves the building.",
  },
  {
    title: "Governed",
    body: "Sanction sits at the gate: a no-egress policy that denies any call trying to leave the box, spend and access limits per user, and a human in the loop where it matters.",
  },
  {
    title: "Provable",
    body: "Every action your AI takes is logged to a signed, append-only audit trail. When the assessor asks what your AI did, you hand them the report, already current.",
  },
]

const steps = [
  {
    n: "01",
    title: "Compliance audit",
    body: "A fixed-scope diagnostic: where AI helps your practice, where the confidentiality and audit risk sits today, and a ranked plan. You leave with a map, not a sales pitch.",
  },
  {
    n: "02",
    title: "Private install",
    body: "We install governed local AI on your hardware: local models, retrieval over your own files, an internal UI your staff can use, and zero cloud egress by design.",
  },
  {
    n: "03",
    title: "Managed compliance",
    body: "We keep the stack current and compliant as models and rules change, and your assessor-ready audit report stays live, handed to you every quarter. For practices under HIPAA, we sign a business-associate agreement, so the paperwork your regulator expects is in place.",
  },
]

export default function LocalOffering() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <header className="border-b border-zinc-900">
        <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
          <div className="flex items-center gap-5 text-sm text-zinc-400">
            <a href="#how" className="hidden hover:text-zinc-100 sm:inline">How it works</a>
            <a href="#engagements" className="hidden hover:text-zinc-100 sm:inline">Engagements</a>
            <a href={CONTACT} className="rounded-md bg-emerald-500 px-3.5 py-1.5 font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
              Book a fit call
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">Sanction Local</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Private AI that never leaves your building.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-zinc-400">
            Your team needs AI, but every public tool puts your client and patient data on someone
            else&apos;s servers. We install AI that runs entirely on your own hardware, and prove it stays
            there with an audit trail your assessor will accept.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={CONTACT} className="rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
              Book a 20-min fit call
            </a>
            <a href="#how" className="rounded-md border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-300 transition-colors hover:text-zinc-100">
              See how it works
            </a>
          </div>
          <p className="mt-6 text-sm text-zinc-600">
            Built for small regulated practices: <span className="text-zinc-400">law firms · clinics · accounting · real estate · specialty manufacturing.</span>
          </p>
        </div>
      </section>

      {/* The problem */}
      <section className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-500">When cloud AI isn&apos;t an option</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <p className="text-zinc-300">
              Confidentiality has teeth. Under <span className="text-zinc-500">ABA Formal Opinion 512</span>, a
              lawyer who puts client matters into a public AI tool takes on duties of competence and
              confidentiality, and usually needs informed client consent first. A clinic would need a signed
              <span className="text-zinc-500">{" "}business-associate agreement</span>{" "}with the vendor.
              Most public tools won&apos;t meet that bar, so your staff use them anyway, and that&apos;s the
              exposure you&apos;ll have to explain.
            </p>
            <p className="text-zinc-300">
              It isn&apos;t only law and medicine. Any practice trusted with a client&apos;s financial or personal
              records, from real estate to accounting to financial advisory, carries the same exposure. The cloud
              AI vendors can&apos;t remove that risk for you. Sending your data to their servers is the whole problem.
              And the big consultancies won&apos;t take a practice your size. So the people with the clearest, most
              urgent need are the ones nobody is serving. That&apos;s who this is for.
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-500">What you get</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {pillars.map((p) => (
              <div key={p.title} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
                <h3 className="font-display text-lg font-semibold tracking-tight text-zinc-100">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works / engagements */}
      <section id="how" className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-500">How it works</h2>
          <p className="mt-4 max-w-2xl text-zinc-400">
            Three steps, each a fixed-scope engagement. Start with the audit; most practices know within
            an hour whether the install is worth it.
          </p>
          <div id="engagements" className="mt-8 grid gap-5 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
                <span className="font-mono text-xs text-zinc-600">{s.n}</span>
                <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-zinc-100">{s.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us / moat */}
      <section className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-500">Why this works when others can&apos;t</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3 text-sm text-zinc-400">
            <p><span className="text-zinc-200">Cloud AI vendors can&apos;t.</span>{" "}&quot;Your data never leaves&quot; is architecturally impossible when the model lives on their servers.</p>
            <p><span className="text-zinc-200">Big consultancies won&apos;t.</span>{" "}A 6-attorney firm or a 3-physician clinic is below their floor. You&apos;re the customer they skip.</p>
            <p><span className="text-zinc-200">We do both.</span>{" "}The whole stack runs on your hardware, and Sanction proves nothing left. The audit trail is the deliverable, not an afterthought.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl text-balance">
            Find out if private AI fits your practice.
          </h2>
          <p className="mt-3 max-w-xl text-zinc-400">
            A 20-minute call: what your team would use AI for, and whether a local install clears your
            compliance bar.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href={CONTACT} className="rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
              Book a fit call
            </a>
          </div>
          <div className="mt-8 max-w-md">
            <p className="mb-2 text-sm text-zinc-500">Or get the one-page overview by email:</p>
            <LeadCapture source="local-ai" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-6 py-10 text-sm text-zinc-600">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-display font-semibold text-zinc-400">Sanction</p>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-zinc-300">Home</Link>
            <a href={CONTACT} className="hover:text-zinc-300">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
