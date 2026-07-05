import type { Prisma } from "./generated/prisma/client"
import { evaluate } from "@/lib/evaluation"
import { SPEND_STATELESS, SPEND_STATEFUL } from "@/lib/rules/spend"
import { PROVISION_STATELESS, PROVISION_STATEFUL } from "@/lib/rules/provision"
import { TOOL_RULES } from "@/lib/rules/tool"
import { CAPABILITY_RULES } from "@/lib/capability"

// Decision evidence (EVID-1). Because rules are pure over their context
// (determinism principle, docs/DOMAIN.md), the evidence for a decision is just
// the ladder name plus the exact context it evaluated: replaying is one call
// to the same pure function. decisionEvidence() runs the ladder itself at
// write time, so what we persist is by construction the decision the route
// enforced; replayEvidence() re-runs it later and proves the record intact.

export const LADDERS = {
  spend: [...SPEND_STATELESS, ...SPEND_STATEFUL],
  provision: [...PROVISION_STATELESS, ...PROVISION_STATEFUL],
  tool: TOOL_RULES,
  capability: CAPABILITY_RULES,
} as const

export type EvidenceLadder = keyof typeof LADDERS

export type DecisionEvidence = {
  ladder: EvidenceLadder
  effect: "allow" | "escalate" | "deny"
  rule_id: string
  code?: string
  reason?: string
  ctx: Record<string, unknown>
}

/** Evaluate the ladder over ctx and package the outcome as persistable evidence. */
export function decisionEvidence(ladder: EvidenceLadder, ctx: Record<string, unknown>) {
  const d = evaluate(ctx as never, LADDERS[ladder] as never)
  const e: DecisionEvidence = { ladder, effect: d.effect, rule_id: d.ruleId, code: d.code, reason: d.reason, ctx }
  // Structurally a plain JSON object; the intersection lets one value serve
  // both readers (DecisionEvidence) and Prisma Json columns.
  return e as DecisionEvidence & Prisma.InputJsonObject
}

export type ReplayResult = {
  effect: string
  rule_id: string
  code?: string
  reason?: string
  /** True when the replay reproduces the persisted outcome exactly. */
  matches: boolean
}

/** Re-run the pure ladder over the stored context and compare to the stored outcome. */
// Rich denials (UX-3): the four questions every denial must answer.
// What happened → code. Why → reason + these numbers. What changes the
// answer → resets_at / the appeal offer. Where is the evidence → links.
// Derived from the decision's own stored evidence, so idempotent replays
// answer identically without re-reading budget state.

export const APPEALABLE_DENIALS = new Set([
  "PER_TXN_LIMIT",
  "DAILY_BUDGET_EXCEEDED",
  "MONTHLY_BUDGET_EXCEEDED",
  "SUBTREE_CAP_EXCEEDED",
])

export type LimitBlock = {
  kind: "per_transaction" | "daily_spend_budget" | "monthly_spend_budget" | "escalation_band"
  limit_usd: number
  used_usd?: number
  remaining_usd?: number
  requested_usd: number
  resets_at?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The limit that fired, with live values, from a decision's stored evidence. */
export function limitFromDecision(code: string | undefined, evidence: unknown): LimitBlock | undefined {
  if (!code || !isDecisionEvidence(evidence)) return undefined
  const c = evidence.ctx as Record<string, unknown>
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const requested = num(c.amountUsd)
  if (requested === undefined) return undefined

  const nextMidnight = () => {
    const d = new Date()
    d.setHours(24, 0, 0, 0)
    return d.toISOString()
  }
  const nextMonthStart = () => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1, 1)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }

  switch (code) {
    case "PER_TXN_LIMIT": {
      const limit = num(c.perTxnMaxCents)
      return limit === undefined ? undefined : { kind: "per_transaction", limit_usd: round2(limit / 100), requested_usd: requested }
    }
    case "DAILY_BUDGET_EXCEEDED": {
      const limit = num(c.dailyBudgetCents)
      const used = num(c.dailySpentUsd) ?? 0
      if (limit === undefined) return undefined
      const limitUsd = round2(limit / 100)
      return {
        kind: "daily_spend_budget",
        limit_usd: limitUsd,
        used_usd: round2(used),
        remaining_usd: round2(Math.max(0, limitUsd - used)),
        requested_usd: requested,
        resets_at: nextMidnight(),
      }
    }
    case "MONTHLY_BUDGET_EXCEEDED": {
      const limit = num(c.monthlyBudgetCents)
      const used = num(c.monthlySpentUsd) ?? 0
      if (limit === undefined) return undefined
      const limitUsd = round2(limit / 100)
      return {
        kind: "monthly_spend_budget",
        limit_usd: limitUsd,
        used_usd: round2(used),
        remaining_usd: round2(Math.max(0, limitUsd - used)),
        requested_usd: requested,
        resets_at: nextMonthStart(),
      }
    }
    case "ESCALATION_REQUIRED": {
      const over = num(c.escalateOverCents)
      return over === undefined ? undefined : { kind: "escalation_band", limit_usd: round2(over / 100), requested_usd: requested }
    }
    default:
      return undefined
  }
}

/** Runtime shape guard — DB Json columns are trusted only after this check. */
export function isDecisionEvidence(v: unknown): v is DecisionEvidence {
  const e = v as DecisionEvidence | null
  return (
    !!e && typeof e === "object" && typeof e.rule_id === "string" &&
    typeof e.effect === "string" && !!e.ctx && typeof e.ctx === "object" &&
    typeof e.ladder === "string" && e.ladder in LADDERS
  )
}

export function replayEvidence(e: DecisionEvidence): ReplayResult | null {
  if (!isDecisionEvidence(e)) return null
  const d = evaluate(e.ctx as never, LADDERS[e.ladder] as never)
  return {
    effect: d.effect,
    rule_id: d.ruleId,
    code: d.code,
    reason: d.reason,
    matches:
      d.effect === e.effect &&
      (d.code ?? null) === (e.code ?? null) &&
      (d.reason ?? null) === (e.reason ?? null) &&
      d.ruleId === e.rule_id,
  }
}
