"use client"

// Card-based diagnostic flow — local state only, nothing leaves the browser
// until the user asks for their diagnostic at the artifact moment (LeadCapture,
// source=authority-diagnostic). Scoring is pure (lib/readiness.ts), so the
// result renders instantly on the last click.

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
      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
        selected
          ? "border-emerald-500/60 bg-emerald-500/10 text-zinc-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
      }`}
    >
      <span className="block text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
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
      <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 print:hidden">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "font-semibold text-emerald-400" : i < step ? "text-zinc-300" : ""}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h2 className="text-lg font-semibold text-zinc-100">Where is AI being used?</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ENVIRONMENTS.map((e) => (
              <Card key={e.id} selected={environment === e.id} onClick={() => setEnvironment(e.id)} label={e.label} />
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2 className="text-lg font-semibold text-zinc-100">What is AI doing today?</h2>
          <p className="mt-1 text-sm text-zinc-400">Pick everything that happens — sanctioned or not.</p>
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
          <h2 className="text-lg font-semibold text-zinc-100">What data could it touch?</h2>
          <p className="mt-1 text-sm text-zinc-400">Not what it is supposed to touch — what it could reach.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {DATA_CLASSES.map((d) => (
              <Card key={d.id} selected={data.includes(d.id)} onClick={() => setData(toggle(data, d.id))} label={d.label} />
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2 className="text-lg font-semibold text-zinc-100">What should require a human?</h2>
          <p className="mt-1 text-sm text-zinc-400">Your instinct is part of the diagnostic. Optional.</p>
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
        <div className="mt-8 flex items-center gap-3 print:hidden">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="text-sm text-zinc-400 hover:text-zinc-200">
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            className="rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-40"
          >
            {step === 3 ? "Show my authority map" : "Continue"}
          </button>
        </div>
      )}
    </div>
  )
}

function ResultView({ result }: { result: ReadinessResult }) {
  return (
    <section>
      <p className="text-sm font-medium text-emerald-400">Your Agent Authority Map</p>
      <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-zinc-100">
        Level {result.level} — {result.levelName}
      </h2>

      <ol className="mt-4 space-y-1.5">
        {LEVELS.map((l) => (
          <li
            key={l.level}
            className={`rounded-md border px-3 py-2 text-sm ${
              l.level === result.level
                ? "border-emerald-500/50 bg-emerald-500/10 text-zinc-100"
                : l.level === 3
                  ? "border-zinc-700 text-zinc-300"
                  : "border-zinc-800/60 text-zinc-500"
            }`}
          >
            <span className="font-medium">
              L{l.level} {l.name}
            </span>
            <span className="ml-2">{l.line}</span>
            {l.level === 3 ? (
              <span className="ml-2 text-xs font-semibold text-emerald-400">← the move that matters</span>
            ) : null}
          </li>
        ))}
      </ol>

      <h3 className="mt-8 text-base font-semibold text-zinc-100">Where authority needs a gate</h3>
      <ul className="mt-3 space-y-3">
        {result.risks.map((r) => (
          <li key={r.title} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm font-medium text-zinc-100">{r.title}</p>
            <p className="mt-1 text-sm text-zinc-400">{r.detail}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-base font-semibold text-zinc-100">Your first governed workflow</h3>
      <p className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-zinc-300">
        {result.firstWorkflow}
      </p>

      <h3 className="mt-8 text-base font-semibold text-zinc-100">Recommended policy posture</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["Auto-approve", result.posture.auto],
            ["Escalate to a human", result.posture.escalate],
            ["Deny", result.posture.deny],
            ["Evidence", result.posture.evidence],
          ] as const
        ).map(([title, items]) => (
          <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm font-medium text-zinc-100">{title}</p>
            <ul className="mt-2 space-y-1 text-sm text-zinc-400">
              {items.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-zinc-400">
        This posture ships as the <span className="font-medium text-zinc-200">{result.packName}</span> policy pack —
        applied in one call, previewable against real history before you commit.
      </p>

      <h3 className="mt-8 text-base font-semibold text-zinc-100">Where Sanction fits</h3>
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <p className="text-sm font-medium text-zinc-100">{result.fit.primary}</p>
        <p className="mt-1 text-sm text-zinc-400">{result.fit.detail}</p>
      </div>

      <h3 className="mt-8 text-base font-semibold text-zinc-100">Before you give AI more authority, ask</h3>
      <ul className="mt-3 space-y-1 text-sm text-zinc-400">
        <li>· Who is acting — a person, a shared account, or an agent?</li>
        <li>· What can it touch that it does not strictly need?</li>
        <li>· Which actions should a human see before they happen?</li>
        <li>· What is denied no matter who asks?</li>
        <li>· If a regulator asks in six months, what can you hand them?</li>
      </ul>

      <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 print:hidden">
        <p className="text-sm font-medium text-zinc-100">Want the policy template for this result?</p>
        <p className="mt-1 text-sm text-zinc-400">
          We&apos;ll send your diagnostic and the matching starter policy. Forward it to whoever owns this decision.
        </p>
        <div className="mt-3">
          <LeadCapture source="authority-diagnostic" />
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href="/start" className="font-medium text-emerald-400 hover:text-emerald-300">
            Install the Sanction MCP server →
          </Link>
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener"
            className="font-medium text-emerald-400 hover:text-emerald-300"
          >
            Book a readiness review →
          </a>
          <button type="button" onClick={() => window.print()} className="font-medium text-zinc-400 hover:text-zinc-200">
            Print / save as PDF
          </button>
        </div>
      </div>
    </section>
  )
}
