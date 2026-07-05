import { evaluate } from "@/lib/evaluation"
import { LADDERS, type DecisionEvidence, type EvidenceLadder } from "@/lib/evidence"
import type { PolicyInput } from "@/lib/policy"
import type { SpendContext } from "@/lib/rules/spend"
import type { CapabilityContext } from "@/lib/capability"

// Retro-simulation (SIM-1): replay stored decision contexts under a candidate
// policy. EVID-1 persisted the exact context each decision evaluated and the
// ladders are pure, so "what would this week have looked like under a $500
// daily budget?" is an overlay + re-evaluate — no live state, no writes.
//
// Honesty contract: slice 1 holds recorded state constant ("as_recorded").
// Budget counters in each context are what the engine saw at that moment;
// cascade effects (an early simulated denial freeing budget for a later
// request) are NOT modeled, and stateless-gate denials carry zeroed counters
// by construction. The response says so.

const toCents = (n: number) => Math.round(n * 100)

// Which candidate fields each ladder can honor. Anything else provided is
// accepted-but-ignored and reported back, never silently dropped.
const SPEND_FIELDS = [
  "per_transaction_max_usd",
  "daily_spend_budget_usd",
  "monthly_spend_budget_usd",
  "auto_approve_under_usd",
  "escalate_over_usd",
  "allowed_categories",
  "blocked_categories",
] as const
const CAPABILITY_FIELDS = ["capability_rules"] as const
const SIMULATABLE_FIELDS = new Set<string>([...SPEND_FIELDS, ...CAPABILITY_FIELDS])

export function partitionFields(p: PolicyInput): { applied: string[]; ignored: string[] } {
  const keys = Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined)
  return {
    applied: keys.filter((k) => SIMULATABLE_FIELDS.has(k)),
    ignored: keys.filter((k) => !SIMULATABLE_FIELDS.has(k)),
  }
}

export const SIMULATABLE_LADDERS: ReadonlySet<EvidenceLadder> = new Set(["spend", "capability"])

// Overlay the candidate's applicable fields onto a stored context. The single
// cast at each function head is the JSON boundary — stored evidence contexts
// arrive untyped; from there on the ladder's own context type holds.
function overlaySpend(ctx: Record<string, unknown>, p: PolicyInput): SpendContext {
  const o = { ...ctx } as SpendContext
  if (p.per_transaction_max_usd !== undefined) o.perTxnMaxCents = toCents(p.per_transaction_max_usd)
  if (p.daily_spend_budget_usd !== undefined) o.dailyBudgetCents = toCents(p.daily_spend_budget_usd)
  if (p.monthly_spend_budget_usd !== undefined) {
    o.monthlyBudgetCents = p.monthly_spend_budget_usd === null ? null : toCents(p.monthly_spend_budget_usd)
  }
  if (p.auto_approve_under_usd !== undefined) o.autoApproveUnderCents = toCents(p.auto_approve_under_usd)
  if (p.escalate_over_usd !== undefined) o.escalateOverCents = toCents(p.escalate_over_usd)
  if (p.allowed_categories !== undefined) o.allowedCategories = p.allowed_categories
  if (p.blocked_categories !== undefined) o.blockedCategories = p.blocked_categories
  return o
}

function overlayCapability(ctx: Record<string, unknown>, p: PolicyInput): CapabilityContext {
  const o = { ...ctx } as CapabilityContext
  if (p.capability_rules !== undefined) o.rules = p.capability_rules
  return o
}

export type SimOutcome = { effect: string; code?: string; rule_id: string }
export type SimResult = { was: SimOutcome; would: SimOutcome; changed: boolean }

/**
 * Re-run one decision's stored evidence under the candidate. `was` is the
 * stored ENGINE outcome (an escalation a human later approved still compares
 * engine-vs-engine). Returns null for ladders the simulation can't honor.
 */
export function simulateEvidence(e: DecisionEvidence, p: PolicyInput): SimResult | null {
  if (!SIMULATABLE_LADDERS.has(e.ladder)) return null
  const d =
    e.ladder === "spend"
      ? evaluate(overlaySpend(e.ctx, p), [...LADDERS.spend])
      : evaluate(overlayCapability(e.ctx, p), [...LADDERS.capability])
  const was: SimOutcome = { effect: e.effect, code: e.code, rule_id: e.rule_id }
  const would: SimOutcome = { effect: d.effect, code: d.code, rule_id: d.ruleId }
  return { was, would, changed: was.effect !== would.effect || (was.code ?? null) !== (would.code ?? null) }
}
