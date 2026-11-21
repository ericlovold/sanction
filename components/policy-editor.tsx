"use client"

import { useActionState, useState, useTransition } from "react"
import {
  simulateDraftAction,
  updatePolicyAction,
  type PolicyActionState,
  type SimActionState,
} from "@/app/dashboard/policy/actions"
import { SimulationReport } from "@/components/simulation-report"
import { ActionFlash } from "@/components/ui/action-flash"
import { MAX_CAPABILITY_RULES, MAX_CAPABILITY_PATTERN_LEN } from "@/lib/policyLimits"

type CapabilityRule = { pattern: string; effect: "block" | "allow" | "escalate" }

type PolicyDollars = {
  daily_token_budget_usd: number
  daily_spend_budget_usd: number
  monthly_spend_budget_usd: number | null
  subtree_daily_cap_usd: number | null
  per_transaction_max_usd: number
  auto_approve_under_usd: number
  escalate_over_usd: number
  allowed_categories: string[]
  blocked_categories: string[]
  allowed_tools: string[]
  blocked_tools: string[]
  escalate_tools: string[]
  // Prisma Json column — loosely typed upstream; narrowed at the boundary below.
  capability_rules: unknown
  escalation_timeout_mins: number
  escalation_timeout_action: string
}

// Every hint states what the engine actually does (verified against
// lib/rules/spend.ts): what the field governs and what happens at the line.
// Field names are the server contract; only the words a person reads changed.
const budgetFields = [
  {
    name: "daily_spend_budget_usd",
    label: "Purchases per day",
    hint: "All agents together. A purchase that would cross this is refused.",
  },
  {
    name: "monthly_spend_budget_usd",
    label: "Purchases per month",
    optional: true,
    hint: "Calendar month. Leave blank for no monthly limit.",
  },
  {
    name: "daily_token_budget_usd",
    label: "Model spend per day",
    hint: "All agents together. Over this, model calls through the gateway are refused until the day resets.",
  },
  {
    name: "subtree_daily_cap_usd",
    label: "Daily cap including groups below",
    optional: true,
    hint: "A hard ceiling for this wallet plus every group under it. Leave blank for none.",
  },
] as const

const approvalFields = [
  {
    name: "auto_approve_under_usd",
    label: "Always approve up to",
    hint: "At or under this, a purchase is approved without asking, even when it is above the ask line.",
  },
  {
    name: "escalate_over_usd",
    label: "Ask a person above",
    hint: "Above this, a purchase waits in Approvals until someone decides.",
  },
  {
    name: "per_transaction_max_usd",
    label: "Largest single purchase",
    hint: "Above this, a purchase is refused outright. It cannot even ask for approval.",
  },
] as const

type MoneyField = (typeof budgetFields)[number] | (typeof approvalFields)[number]

const initial: PolicyActionState = { ok: false, message: "" }
const simInitial: SimActionState = { ok: false, message: "" }

function toRules(value: unknown): CapabilityRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) =>
    v && typeof v === "object" && "pattern" in v && "effect" in v
      ? [{ pattern: String((v as CapabilityRule).pattern), effect: (v as CapabilityRule).effect }]
      : [],
  )
}

export function PolicyEditor({ policy, editable, readOnlyNote }: { policy: PolicyDollars; editable: boolean; readOnlyNote?: string }) {
  const [state, formAction, pending] = useActionState(updatePolicyAction, initial)
  const [simState, simAction, simulating] = useActionState(simulateDraftAction, simInitial)
  const [, startSimulation] = useTransition()
  const [perTxn, setPerTxn] = useState(policy.per_transaction_max_usd)
  const [escalate, setEscalate] = useState(policy.escalate_over_usd)
  const [rules, setRules] = useState<CapabilityRule[]>(() => toRules(policy.capability_rules))
  const escalationDead = escalate >= perTxn

  const setRule = (i: number, patch: Partial<CapabilityRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const moneyField = (f: MoneyField) => (
    <label key={f.name}>
      {f.label}
      <span className="pol-money">
        <span aria-hidden>$</span>
        <input
          type="number"
          name={f.name}
          step="0.01"
          min="0"
          disabled={!editable}
          defaultValue={policy[f.name] ?? ""}
          placeholder={"optional" in f && f.optional ? "No limit" : undefined}
          onChange={
            f.name === "per_transaction_max_usd"
              ? (e) => setPerTxn(Number(e.target.value))
              : f.name === "escalate_over_usd"
                ? (e) => setEscalate(Number(e.target.value))
                : undefined
          }
        />
      </span>
      <span className="pol-hint">{f.hint}</span>
    </label>
  )

  const listInput = (name: string, label: string, value: string[], hint: string) => (
    <label>
      {label}
      <input name={name} disabled={!editable} defaultValue={value.join(", ")} placeholder="None" className="g-input pol-mono" />
      <span className="pol-hint">{hint}</span>
    </label>
  )

  return (
    <div>
      <form action={formAction}>
        {/* Serialized capability rules: one hidden JSON input; the server's
            capabilityRules zod is the single validator. */}
        <input type="hidden" name="capability_rules" value={JSON.stringify(rules)} />

        <section className="home-section" aria-labelledby="pol-limits">
          <h2 id="pol-limits" className="home-h2">Spending limits</h2>
          <p className="pol-lede">Hard lines, checked before every action.</p>
          <div className="g-panel pol-panel">
            <div className="seat-form-grid pol-grid">{budgetFields.map(moneyField)}</div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="pol-purchase">
          <h2 id="pol-purchase" className="home-h2">One purchase</h2>
          <p className="pol-lede">Small purchases go through, larger ones wait for a person, and the largest are refused.</p>
          <div className="g-panel pol-panel">
            <div className="seat-form-grid pol-grid">{approvalFields.map(moneyField)}</div>
            {escalationDead && (
              <p className="pol-warn">
                A person will never be asked about a purchase: anything above &ldquo;Largest single purchase&rdquo; is
                refused first. Set &ldquo;Ask a person above&rdquo; lower than it to make approval reachable.
              </p>
            )}
            <div className="seat-form-grid pol-grid pol-gap">
              <label>
                How long to wait for an answer (minutes)
                <input
                  type="number"
                  name="escalation_timeout_mins"
                  step="1"
                  min="0"
                  max="10080"
                  disabled={!editable}
                  defaultValue={policy.escalation_timeout_mins}
                  className="g-input"
                />
                <span className="pol-hint">Applies to every request that waits for a person. 0 means no time limit.</span>
              </label>
              <label>
                If nobody answers in time
                <select name="escalation_timeout_action" disabled={!editable} defaultValue={policy.escalation_timeout_action} className="g-input">
                  <option value="deny">Refuse it</option>
                  <option value="approve">Approve it</option>
                </select>
                <span className="pol-hint">Refusing is the safe default.</span>
              </label>
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="pol-what">
          <h2 id="pol-what" className="home-h2">What agents may buy and use</h2>
          <p className="pol-lede">Lists are separated by commas. A blocked entry always wins.</p>
          <div className="g-panel pol-panel">
            <div className="seat-form-grid pol-grid pol-grid-wide">
              {listInput(
                "allowed_categories",
                "Allowed purchase categories",
                policy.allowed_categories,
                "Empty means every category. If set, purchases outside these are refused.",
              )}
              {listInput("blocked_categories", "Blocked purchase categories", policy.blocked_categories, "Always refused.")}
            </div>
            <div className="seat-form-grid pol-grid pol-gap">
              {listInput(
                "allowed_tools",
                "Allowed tools",
                policy.allowed_tools,
                "Empty means every tool. If set, any tool not listed is refused. Names are case-sensitive.",
              )}
              {listInput("blocked_tools", "Blocked tools", policy.blocked_tools, "Always refused.")}
              {listInput("escalate_tools", "Tools that ask a person", policy.escalate_tools, "These wait for approval on every call.")}
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="pol-caps">
          <div className="home-section-head" style={{ marginBottom: 0 }}>
            <h2 id="pol-caps" className="home-h2">
              New capabilities
              <span>{rules.length} of {MAX_CAPABILITY_RULES}</span>
            </h2>
            {editable && rules.length < MAX_CAPABILITY_RULES && (
              <button type="button" onClick={() => setRules((rs) => [...rs, { pattern: "", effect: "escalate" }])} className="g-btn g-btn-quiet g-btn-sm">
                Add rule
              </button>
            )}
          </div>
          <p className="pol-lede">
            What agents may take on: installing skills, adding plugins, reaching new APIs. A pattern ending in{" "}
            <span className="pol-mono">*</span> matches everything that starts with it. Block wins, then the allow list, then ask.
          </p>
          <div className="g-panel pol-panel">
            {rules.length === 0 && (
              <p className="pol-hint" style={{ margin: 0 }}>
                No rules, so taking on skills, plugins and APIs is not governed. A common first rule is{" "}
                <span className="pol-mono">skill:install:*</span> set to ask a person.
              </p>
            )}
            <div className="pol-rules">
              {rules.map((r, i) => (
                <div key={i} className="pol-rule">
                  <input
                    value={r.pattern}
                    disabled={!editable}
                    maxLength={MAX_CAPABILITY_PATTERN_LEN}
                    onChange={(e) => setRule(i, { pattern: e.target.value })}
                    placeholder="skill:install:*"
                    aria-label={`Rule ${i + 1} pattern`}
                    className="g-input pol-mono"
                  />
                  <select
                    value={r.effect}
                    disabled={!editable}
                    onChange={(e) => setRule(i, { effect: e.target.value as CapabilityRule["effect"] })}
                    aria-label={`Rule ${i + 1} outcome`}
                    className="g-input"
                  >
                    <option value="block">Block</option>
                    <option value="allow">Allow</option>
                    <option value="escalate">Ask a person</option>
                  </select>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                      className="g-btn g-btn-quiet g-btn-sm"
                      aria-label={`Remove rule ${i + 1}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {editable ? (
          // Sticks to the bottom of the window so Save is always in reach on a
          // long form.
          <div className="pol-save g-glass">
            <div className="pol-save-flash">
              {/* Saving is the completed task: announce it, then revert to default. */}
              <ActionFlash state={state} />
            </div>
            {/* Not a submit button on purpose. React resets a form's fields after
                a form action runs, so submitting the draft to the simulation
                wiped the edits being tried, and the next Save wrote the old
                values. Sending the same FormData by hand leaves the fields alone. */}
            <button
              type="button"
              disabled={simulating}
              onClick={(event) => {
                const form = event.currentTarget.form
                if (!form || !form.reportValidity()) return
                const draft = new FormData(form)
                startSimulation(() => simAction(draft))
              }}
              className="g-btn g-btn-quiet"
            >
              {simulating ? "Trying it…" : "Try on past requests"}
            </button>
            <button type="submit" disabled={pending} className="g-btn g-btn-primary">
              {pending ? "Saving…" : "Save policy"}
            </button>
          </div>
        ) : (
          <div className="pol-readonly">
            <span>{readOnlyNote ?? "Viewing the demo. Log in to edit your own policy."}</span>
            {!readOnlyNote && (
              <a href="/login" className="g-btn g-btn-quiet">
                Log in
              </a>
            )}
          </div>
        )}
      </form>

      {simState.message && !simState.ok && (
        <p className="add-pop-error" aria-live="polite">{simState.message}</p>
      )}
      {simState.ok && simState.report && (
        <div className="home-section">
          <SimulationReport report={simState.report} title="This draft against your last 7 days" />
        </div>
      )}
    </div>
  )
}
