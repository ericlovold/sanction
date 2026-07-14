import type { Metadata } from "next"
import Link from "next/link"
import { LeadCapture } from "@/components/lead-capture"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

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
    body: "Every action your AI takes is logged to an append-only audit trail. When the assessor asks what your AI did, you hand them the report, already current.",
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

const sectionBorder = { borderBottom: "1px solid var(--paper-3)" }
const card = { borderColor: "var(--paper-3)", background: "var(--surface-card)" }
const monoLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
}

export default function LocalOffering() {
  return (
    <div
      className={`sanction ${brandFontVars}`}
      style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}
    >
      {/* Nav */}
      <header style={sectionBorder}>
        <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" style={{ fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            Sanction
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <a href="#how" className="sanction-link hidden sm:inline">How it works</a>
            <a href="#install" className="sanction-link hidden sm:inline">Install package</a>
            <a href="#engagements" className="sanction-link hidden sm:inline">Outcomes Are Everything</a>
            <a href={CONTACT} className="sn-btn sn-btn-primary sn-btn-s">
              Book a fit call
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p style={{ ...monoLabel, color: "var(--status-approved)" }}>Sanction Local</p>
          <h1 className="text-balance" style={{ font: "var(--text-display)", letterSpacing: "-0.02em", marginTop: 16 }}>
            Private AI that never leaves your building.
          </h1>
          <p className="max-w-2xl" style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", marginTop: 20 }}>
            Your team needs AI, but every public tool puts your client and patient data on someone
            else&apos;s servers. We install AI that runs entirely on your own hardware, and prove it stays
            there with an audit trail your assessor will accept.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={CONTACT} className="sn-btn sn-btn-primary sn-btn-l">
              Book a 20-min fit call
            </a>
            <a href="#how" className="sn-btn sn-btn-secondary sn-btn-l">
              See how it works
            </a>
          </div>
          <p className="mt-6 text-sm" style={{ color: "var(--text-faint)" }}>
            Built for small regulated practices:{" "}
            <span style={{ color: "var(--text-muted)" }}>
              law firms · clinics · accounting · real estate · specialty manufacturing.
            </span>
          </p>
        </div>
      </section>

      {/* The problem */}
      <section style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 style={monoLabel}>When cloud AI isn&apos;t an option</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <p style={{ color: "var(--text-secondary)" }}>
              Confidentiality has teeth. Under <span style={{ color: "var(--text-body)" }}>ABA Formal Opinion 512</span>, a
              lawyer who puts client matters into a public AI tool takes on duties of competence and
              confidentiality, and usually needs informed client consent first. A clinic would need a signed
              <span style={{ color: "var(--text-body)" }}>{" "}business-associate agreement</span>{" "}with the vendor.
              Most public tools won&apos;t meet that bar, so your staff use them anyway, and that&apos;s the
              exposure you&apos;ll have to explain.
            </p>
            <p style={{ color: "var(--text-secondary)" }}>
              It isn&apos;t only law and medicine. Any practice trusted with a client&apos;s financial or personal
              records, from real estate to accounting to financial advisory, carries the same exposure. The cloud
              AI vendors can&apos;t remove that risk for you. Sending your data to their servers is the whole problem.
              And the big consultancies won&apos;t take a practice your size.
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 style={monoLabel}>What you get</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {pillars.map((p) => (
              <div key={p.title} className="rounded-lg border p-6" style={card}>
                <h3 className="text-lg font-semibold" style={{ letterSpacing: "-0.01em" }}>{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install package — the governance artifacts that ship with Local */}
      <section id="install" style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 style={monoLabel}>The install package</h2>
          <p className="mt-4 max-w-2xl" style={{ color: "var(--text-secondary)" }}>
            Two artifacts make Local provable before the hardware arrives: a policy that denies
            cloud egress, and a signed evidence export your assessor verifies without a walkthrough.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="rounded-lg border p-6" style={card}>
              <h3 className="text-lg font-semibold" style={{ letterSpacing: "-0.01em" }}>No-egress policy pack</h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Apply <code style={{ color: "var(--text-body)" }}>no-egress</code> from the dashboard
                or API. Only on-box tools pass; named cloud calls deny and persist as audit rows.
                Preview it against your last 30 days before you commit.
              </p>
              <Link href="/compatibility" className="sanction-link mt-4 inline-block text-sm font-medium">
                See channel packs →
              </Link>
            </div>
            <div className="rounded-lg border p-6" style={card}>
              <h3 className="text-lg font-semibold" style={{ letterSpacing: "-0.01em" }}>Assessor evidence export</h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                From the Audit console, download a signed, hash-chained JSON of every governed
                decision. Alter, drop, or reorder a row and the chain breaks at a named link —
                verifiable self-contained.
              </p>
              <Link href="/docs/compatibility" className="sanction-link mt-4 inline-block text-sm font-medium">
                Compatibility &amp; evidence badges →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works / engagements */}
      <section id="how" style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 style={monoLabel}>How it works</h2>
          <p className="mt-4 max-w-2xl" style={{ color: "var(--text-secondary)" }}>
            Three steps, each a fixed-scope engagement. Start with the audit; most practices know within
            an hour whether the install is worth it.
          </p>
          <div id="engagements" className="mt-8 grid gap-5 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="flex flex-col rounded-lg border p-6" style={card}>
                <span style={{ ...monoLabel, fontSize: 12, color: "var(--text-faint)" }}>{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold" style={{ letterSpacing: "-0.01em" }}>{s.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us / moat */}
      <section style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 style={monoLabel}>Why this works when others can&apos;t</h2>
          <div className="mt-6 grid gap-6 text-sm md:grid-cols-3" style={{ color: "var(--text-secondary)" }}>
            <p><span style={{ color: "var(--text-body)", fontWeight: 500 }}>Cloud AI vendors can&apos;t.</span>{" "}&quot;Your data never leaves&quot; is architecturally impossible when the model lives on their servers.</p>
            <p><span style={{ color: "var(--text-body)", fontWeight: 500 }}>Big consultancies won&apos;t.</span>{" "}A 6-attorney firm or a 3-physician clinic is below their floor. You&apos;re the customer they skip.</p>
            <p><span style={{ color: "var(--text-body)", fontWeight: 500 }}>We do both.</span>{" "}The whole stack runs on your hardware, and Sanction proves nothing left. The audit trail is the deliverable, not an afterthought.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={sectionBorder}>
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-balance" style={{ font: "var(--text-h2)", letterSpacing: "-0.02em" }}>
            Find out if private AI fits your practice.
          </h2>
          <p className="mt-3 max-w-xl" style={{ color: "var(--text-secondary)" }}>
            A 20-minute call: what your team would use AI for, and whether a local install clears your
            compliance bar.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <a href={CONTACT} className="sn-btn sn-btn-primary sn-btn-l">
              Book a fit call
            </a>
            <Link href="/readiness" className="sanction-link text-sm font-medium">
              Or take the 5-minute readiness check →
            </Link>
          </div>
          <div className="mt-8 max-w-md">
            <p className="mb-2 text-sm" style={{ color: "var(--text-muted)" }}>Or get the one-page overview by email:</p>
            <LeadCapture source="local-ai" variant="light" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-6 py-10 text-sm" style={{ color: "var(--text-faint)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p style={{ fontWeight: 600, color: "var(--text-muted)" }}>Sanction</p>
          <div className="flex gap-5">
            <Link href="/" className="sanction-link">Home</Link>
            <a href={CONTACT} className="sanction-link">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
