"use client"

import { useActionState, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
// lib/rules/spend.ts) — what the field governs and what happens at the line.
const dollarFields = [
  {
    name: "daily_token_budget_usd",
    label: "Daily token budget",
    hint: "Model-token spend per day, all agents combined. Over budget, gateway calls are refused until the day resets.",
  },
  {
    name: "daily_spend_budget_usd",
    label: "Daily spend budget",
    hint: "Total purchases per day. A request that would cross this is denied.",
  },
  {
    name: "monthly_spend_budget_usd",
    label: "Monthly spend budget",
    optional: true,
    hint: "Calendar-month ceiling on purchases. Blank = no monthly cap.",
  },
  {
    name: "subtree_daily_cap_usd",
    label: "Subtree daily cap",
    optional: true,
    hint: "Hard daily ceiling for this wallet plus every pool beneath it. Blank = no cap.",
  },
  {
    name: "per_transaction_max_usd",
    label: "Per-transaction max",
    hint: "The most one request may spend. Above this is denied outright — it can't even ask for approval.",
  },
  {
    name: "auto_approve_under_usd",
    label: "Auto-approve under",
    hint: "At or under this, spend is approved silently — it never waits on a human.",
  },
  {
    name: "escalate_over_usd",
    label: "Escalate over",
    hint: "Above this, spend pauses in your approvals inbox until you decide.",
  },
] as const

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

export function PolicyEditor({ policy, editable }: { policy: PolicyDollars; editable: boolean }) {
  const [state, formAction, pending] = useActionState(updatePolicyAction, initial)
  const [simState, simAction, simulating] = useActionState(simulateDraftAction, simInitial)
  const [perTxn, setPerTxn] = useState(policy.per_transaction_max_usd)
  const [escalate, setEscalate] = useState(policy.escalate_over_usd)
  const [rules, setRules] = useState<CapabilityRule[]>(() => toRules(policy.capability_rules))
  const escalationDead = escalate >= perTxn

  const setRule = (i: number, patch: Partial<CapabilityRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const listInput = (name: string, label: string, value: string[], hint: string, danger?: boolean) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-zinc-600">{label}</span>
      <input
        name={name}
        disabled={!editable}
        defaultValue={value.join(", ")}
        className={`mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-zinc-600 ${danger ? "text-red-300" : "text-zinc-100"}`}
      />
      <span className="mt-1 block text-[10px] leading-snug text-zinc-600">{hint}</span>
    </label>
  )

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">Policy</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="space-y-5">
          {/* Serialized capability rules — one hidden JSON input; the server's
              capabilityRules zod is the single validator. */}
          <input type="hidden" name="capability_rules" value={JSON.stringify(rules)} />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {dollarFields.map((f) => (
              <label key={f.name} className="block">
                <span className="text-[11px] uppercase tracking-wide text-zinc-600">{f.label}</span>
                <div className="mt-1 flex items-center rounded-md border border-zinc-800 bg-zinc-950 focus-within:border-zinc-600">
                  <span className="pl-2.5 font-mono text-sm text-zinc-600">$</span>
                  <input
                    type="number"
                    name={f.name}
                    step="0.01"
                    min="0"
                    disabled={!editable}
                    defaultValue={policy[f.name] ?? ""}
                    placeholder={"optional" in f && f.optional ? "No cap" : undefined}
                    onChange={
                      f.name === "per_transaction_max_usd"
                        ? (e) => setPerTxn(Number(e.target.value))
                        : f.name === "escalate_over_usd"
                          ? (e) => setEscalate(Number(e.target.value))
                          : undefined
                    }
                    className="w-full bg-transparent px-2 py-1.5 font-mono text-sm text-zinc-100 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <span className="mt-1 block text-[10px] leading-snug text-zinc-600">{f.hint}</span>
              </label>
            ))}
          </div>

          {escalationDead && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
              Escalation will never trigger: a charge has to clear &ldquo;Per-transaction max&rdquo; before it can
              escalate, so set &ldquo;Escalate over&rdquo; below it for human approval to be reachable.
            </p>
          )}

          {/* Escalation timeout */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-zinc-600">Escalation timeout (min)</span>
              <input
                type="number"
                name="escalation_timeout_mins"
                step="1"
                min="0"
                max="10080"
                disabled={!editable}
                defaultValue={policy.escalation_timeout_mins}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="mt-1 block text-[10px] leading-snug text-zinc-600">
                How long an escalated request waits for a human before the timeout action applies. 0 = waits forever.
              </span>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-zinc-600">On timeout</span>
              <select
                name="escalation_timeout_action"
                disabled={!editable}
                defaultValue={policy.escalation_timeout_action}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              >
                <option value="deny">Deny (fail closed)</option>
                <option value="approve">Approve</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {listInput(
              "allowed_categories",
              "Allowed categories",
              policy.allowed_categories,
              "Comma-separated. Empty = every category allowed. If set, spend outside these is denied.",
            )}
            {listInput(
              "blocked_categories",
              "Blocked categories",
              policy.blocked_categories,
              "Always denied — blocked wins, even over the allow list.",
              true,
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {listInput(
              "allowed_tools",
              "Allowed tools",
              policy.allowed_tools,
              "Empty = every tool allowed. If set, unlisted tools are denied. Case-sensitive.",
            )}
            {listInput(
              "blocked_tools",
              "Blocked tools",
              policy.blocked_tools,
              "Always denied — blocked wins.",
              true,
            )}
            {listInput(
              "escalate_tools",
              "Escalate tools",
              policy.escalate_tools,
              "These tools pause for your approval on every call.",
            )}
          </div>

          {/* Capability rules — ordered block → allow-list → escalate */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-zinc-600">
                Capability rules ({rules.length}/{MAX_CAPABILITY_RULES})
              </span>
              {editable && rules.length < MAX_CAPABILITY_RULES && (
                <button
                  type="button"
                  onClick={() => setRules((rs) => [...rs, { pattern: "", effect: "escalate" }])}
                  className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                >
                  + Add rule
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">
              Governs what agents may <em>acquire</em> — installing skills, adding plugins, reaching new APIs. Patterns
              prefix-match with <span className="font-mono">*</span>; block wins, then the allow list, then escalate.
            </p>
            <div className="mt-2 space-y-2">
              {rules.length === 0 && (
                <p className="text-[11px] text-zinc-600">
                  No capability rules — acquiring skills/plugins/APIs is ungoverned. Add a rule like{" "}
                  <span className="font-mono">skill:install:*</span> → escalate.
                </p>
              )}
              {rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.pattern}
                    disabled={!editable}
                    maxLength={MAX_CAPABILITY_PATTERN_LEN}
                    onChange={(e) => setRule(i, { pattern: e.target.value })}
                    placeholder="skill:install:*"
                    className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-600"
                  />
                  <select
                    value={r.effect}
                    disabled={!editable}
                    onChange={(e) => setRule(i, { effect: e.target.value as CapabilityRule["effect"] })}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                  >
                    <option value="block">block</option>
                    <option value="allow">allow</option>
                    <option value="escalate">escalate</option>
                  </select>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                      className="shrink-0 rounded-md border border-zinc-800 px-2 py-1.5 text-xs text-zinc-500 hover:text-red-400"
                      aria-label="Remove rule"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {editable ? (
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                {/* Overrides the form's save action for this button only (React 19):
                    same 15-field FormData, but replays it over history instead of writing. */}
                <button
                  type="submit"
                  formAction={simAction}
                  disabled={simulating}
                  className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-50"
                >
                  {simulating ? "Simulating…" : "Simulate before saving"}
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save policy"}
                </button>
              </div>
              {/* Saving is the completed task — announce it, then revert to default. */}
              <ActionFlash state={state} />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500">Viewing the demo — log in to edit your own policy.</span>
              <a href="/login" className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800">
                Log in
              </a>
            </div>
          )}
        </form>

        {simState.message && !simState.ok && (
          <p className="mt-4 text-xs text-red-400" aria-live="polite">{simState.message}</p>
        )}
        {simState.ok && simState.report && (
          <div className="mt-4">
            <SimulationReport report={simState.report} title="Draft simulation — your last 7 days" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
