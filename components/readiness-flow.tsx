"use client"

// Card-based diagnostic flow — local state only, nothing leaves the browser
// until the user asks for their diagnostic at the artifact moment (LeadCapture,
// source=authority-diagnostic). Scoring is pure (lib/readiness.ts), so the
// result renders instantly on the last click.
//
// Styled with the brand system (app/brand.css) — this component renders only
// inside a `.sanction`-scoped page, so the tokens always resolve.

import { useState } from "react"
import Link from "next/link"
import { LeadCapture } from "@/components/lead-capture"
import {
  scoreReadiness,
  LEVELS,
  type Activity,
  type ApprovalInstinct,
  type DataClass,
  type Environment,
  type ReadinessResult,
} from "@/lib/readiness"

const ENVIRONMENTS: { id: Environment; label: string }[] = [
  { id: "law", label: "Law firm" },
  { id: "clinic", label: "Clinic / healthcare" },
  { id: "finance", label: "Accounting / finance" },
  { id: "realestate", label: "Real estate" },
  { id: "dev", label: "Software / dev team" },
  { id: "agency", label: "AI agency / consultant" },
  { id: "other", label: "Something else" },
]

const ACTIVITIES: { id: Activity; label: string; hint: string }[] = [
  { id: "drafting", label: "Drafting documents", hint: "letters, notes, summaries" },
  { id: "retrieval", label: "Searching internal files", hint: "asking questions over your documents" },
  { id: "tools", label: "Using tools", hint: "browser, plugins, MCP servers, integrations" },
  { id: "external_send", label: "Sending email or messages", hint: "anything that leaves the org" },
  { id: "credentials", label: "Accessing credentials", hint: "passwords, API keys, logins" },
  { id: "spend", label: "Spending or provisioning", hint: "purchases, subscriptions, cloud resources" },
  { id: "write_systems", label: "Writing to systems", hint: "CRM records, code, configuration" },
  { id: "unsure", label: "Honestly — not sure", hint: "people use their own tools" },
]

const DATA_CLASSES: { id: DataClass; label: string }[] = [
  { id: "public", label: "Public information" },
  { id: "internal", label: "Internal documents" },
  { id: "client", label: "Client-confidential data" },
  { id: "financial", label: "Financial records" },
  { id: "phi", label: "Health data (PHI)" },
  { id: "privileged", label: "Legally privileged material" },
  { id: "secrets", label: "Credentials / secrets" },
]

const APPROVALS: { id: ApprovalInstinct; label: string }[] = [
  { id: "client_data", label: "Any client data access" },
  { id: "external_send", label: "Any external send" },
  { id: "spend", label: "Any spend" },
  { id: "threshold", label: "Spend above a threshold" },
  { id: "new_tools", label: "New tools / plugins" },
  { id: "credentials", label: "Any credential use" },
  { id: "first_time", label: "First-time actions" },
]

const STEPS = ["Environment", "What AI does", "Data involved", "Approvals", "Your map"] as const

// Same default + override as the homepage's "Talk to us" CTA (app/page.tsx).
const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/eric-getsanction/30min"

function Card({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="rounded-lg border px-4 py-3 text-left transition-colors"
      style={
        selected
          ? { borderColor: "var(--action-primary)", background: "var(--status-approved-bg)", color: "var(--text-body)" }
          : { borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-secondary)" }
      }
    >
      <span className="block text-sm font-medium" style={{ color: "var(--text-body)" }}>
        {label}
      </span>
      {hint && (
        <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </button>
  )
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

export function ReadinessFlow() {
  const [step, setStep] = useState(0)
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [data, setData] = useState<DataClass[]>([])
  const [approvals, setApprovals] = useState<ApprovalInstinct[]>([])
  const [result, setResult] = useState<ReadinessResult | null>(null)

  const canContinue =
    step === 0 ? environment !== null : step === 1 ? activities.length > 0 : step === 2 ? data.length > 0 : true

  function next() {
    if (step === 3 && environment) {
      setResult(scoreReadiness({ environment, activities, data, approvals }))
    }
    setStep(step + 1)
  }

  return (
    <div>
      <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1 text-xs print:hidden" style={{ color: "var(--text-muted)" }}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            style={
              i === step
                ? { color: "var(--action-primary)", fontWeight: 600 }
                : i < step
                  ? { color: "var(--text-secondary)" }
                  : undefined
            }
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h2 className="text-lg font-semibold">Where is AI being used?</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ENVIRONMENTS.map((e) => (
              <Card key={e.id} selected={environment === e.id} onClick={() => setEnvironment(e.id)} label={e.label} />
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2 className="text-lg font-semibold">What is AI doing today?</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Pick everything that happens — sanctioned or not.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ACTIVITIES.map((a) => (
              <Card
                key={a.id}
                selected={activities.includes(a.id)}
                onClick={() => setActivities(toggle(activities, a.id))}
                label={a.label}
                hint={a.hint}
              />
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2 className="text-lg font-semibold">What data could it touch?</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Not what it is supposed to touch — what it could reach.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {DATA_CLASSES.map((d) => (
              <Card key={d.id} selected={data.includes(d.id)} onClick={() => setData(toggle(data, d.id))} label={d.label} />
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2 className="text-lg font-semibold">What should require a human?</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Your instinct is part of the diagnostic. Optional.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {APPROVALS.map((a) => (
              <Card
                key={a.id}
                selected={approvals.includes(a.id)}
                onClick={() => setApprovals(toggle(approvals, a.id))}
                label={a.label}
              />
            ))}
          </div>
        </section>
      )}

      {step === 4 && result && <ResultView result={result} />}

      {step < 4 && (
        <div className="mt-8 flex items-center gap-4 print:hidden">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="sanction-link text-sm">
              Back
            </button>
          )}
          <button type="button" onClick={next} disabled={!canContinue} className="sn-btn sn-btn-primary sn-btn-m">
            {step === 3 ? "Show my authority map" : "Continue"}
          </button>
        </div>
      )}
    </div>
  )
}

function ResultView({ result }: { result: ReadinessResult }) {
  return (
    <section id="authority-map">
      {/* Print-only document header — on paper this is the title block. */}
      <div className="hidden print:block">
        <p className="text-xs uppercase tracking-widest">Agent Authority Map</p>
        <p className="mt-1 text-xs">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      <p className="print-accent sn-mono text-sm print:hidden" style={{ color: "var(--status-approved)" }}>
        Your Agent Authority Map
      </p>

      {/* The reframe lands BEFORE the number sinks in — preempt the misread
          ("I got a bad grade") rather than correct it after. */}
      <p className="mt-2 text-lg font-semibold" style={{ letterSpacing: "-0.01em" }}>
        Not a score — a leash length.
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        Your level measures how much authority AI can safely hold in your organization today, given what&apos;s
        gated. It says nothing about how well you use AI.
      </p>

      <h2 className="print-accent mt-5 text-2xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
        Level {result.level} — {result.levelName}
      </h2>

      {/* The user's own words, echoed — "the quiz heard me," not "the quiz
          misjudged me." Drivers derive strictly from actual answers. */}
      <ul className="mt-3 space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {result.drivers.map((d) => (
          <li key={d}>· {d}</li>
        ))}
      </ul>

      <ol className="mt-5 space-y-1.5">
        {LEVELS.map((l) => (
          <li
            key={l.level}
            className="rounded-md border px-3 py-2 text-sm"
            style={
              l.level === result.level
                ? { borderColor: "var(--action-primary)", background: "var(--status-approved-bg)", color: "var(--text-body)" }
                : l.level === 3
                  ? { borderColor: "var(--ink-4)", color: "var(--text-secondary)" }
                  : { borderColor: "var(--paper-3)", color: "var(--text-muted)" }
            }
          >
            <span className="font-medium">
              L{l.level} {l.name}
            </span>
            <span className="ml-2">{l.line}</span>
            {l.level === 3 ? (
              <span className="ml-2 text-xs font-semibold" style={{ color: "var(--status-approved)" }}>
                ← the move that matters
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {/* Close the level story as an upsell, not a verdict. */}
      <p
        className="mt-3 rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--paper-3)", background: "var(--surface-sunken)", color: "var(--text-body)" }}
      >
        A Level {result.level} organization isn&apos;t behind — it&apos;s ungated. The same organization runs
        safely two levels higher with gates in front of privileged actions. That move starts with the first
        governed workflow below.
      </p>

      <h3 className="mt-8 text-base font-semibold">Where authority needs a gate</h3>
      <ul className="mt-3 space-y-3">
        {result.risks.map((r) => (
          <li key={r.title} className="rounded-lg border p-4" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)" }}>
            <p className="text-sm font-medium">{r.title}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {r.detail}
            </p>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-base font-semibold">Your first governed workflow</h3>
      <p
        className="mt-2 rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--status-approved)", background: "var(--status-approved-bg)", color: "var(--text-body)" }}
      >
        {result.firstWorkflow}
      </p>

      <h3 className="mt-8 text-base font-semibold">Recommended policy posture</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["Auto-approve", result.posture.auto],
            ["Escalate to a human", result.posture.escalate],
            ["Deny", result.posture.deny],
            ["Evidence", result.posture.evidence],
          ] as const
        ).map(([title, items]) => (
          <div key={title} className="rounded-lg border p-4" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)" }}>
            <p className="text-sm font-medium">{title}</p>
            <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {items.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        This posture ships as the <span className="font-medium" style={{ color: "var(--text-body)" }}>{result.packName}</span>{" "}
        policy pack — applied in one call, previewable against real history before you commit.
      </p>

      <h3 className="mt-8 text-base font-semibold">Before you give AI more authority, ask</h3>
      <ul className="mt-3 space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        <li>· Who is acting — a person, a shared account, or an agent?</li>
        <li>· What can it touch that it does not strictly need?</li>
        <li>· Which actions should a human see before they happen?</li>
        <li>· What is denied no matter who asks?</li>
        <li>· If a regulator asks in six months, what can you hand them?</li>
      </ul>

      <div className="mt-10 print:hidden">
        <button type="button" onClick={() => window.print()} className="sn-btn sn-btn-primary sn-btn-l w-full sm:w-auto">
          Download your Authority Map ↓
        </button>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Saves as a PDF — forward it to whoever owns this decision.
        </p>
      </div>

      <div className="mt-8 rounded-lg border p-5 print:hidden" style={{ borderColor: "var(--paper-3)", background: "var(--surface-sunken)" }}>
        <p className="text-sm font-medium">Want the policy template for this result?</p>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          We&apos;ll send your diagnostic and the matching starter policy.
        </p>
        <div className="mt-3">
          <LeadCapture source="authority-diagnostic" variant="light" />
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href="/start" className="sanction-link font-medium">
            Install the Sanction MCP server →
          </Link>
          <a href={CALENDLY_URL} target="_blank" rel="noopener" className="sanction-link font-medium">
            Book a readiness review →
          </a>
        </div>
      </div>

      {/* Print-only footer — the one line of presence on the deliverable. */}
      <p className="mt-10 hidden border-t pt-3 text-xs print:block">
        Prepared with the Sanction Agent Authority Readiness Check · getsanction.com/readiness
      </p>
    </section>
  )
}
