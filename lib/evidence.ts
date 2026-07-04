import type { Prisma } from "./generated/prisma/client"
import { evaluate } from "@/lib/evaluation"
import { SPEND_STATELESS, SPEND_STATEFUL } from "@/lib/rules/spend"
import { PROVISION_STATELESS, PROVISION_STATEFUL } from "@/lib/rules/provision"
import { TOOL_RULES } from "@/lib/rules/tool"

// Decision evidence (EVID-1). Because rules are pure over their context
// (determinism principle, docs/DOMAIN.md), the evidence for a decision is just
// the ladder name plus the exact context it evaluated: replaying is one call
// to the same pure function. decisionEvidence() runs the ladder itself at
// write time, so what we persist is by construction the decision the route
// enforced; replayEvidence() re-runs it later and proves the record intact.

const LADDERS = {
  spend: [...SPEND_STATELESS, ...SPEND_STATEFUL],
  provision: [...PROVISION_STATELESS, ...PROVISION_STATEFUL],
  tool: TOOL_RULES,
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
export function replayEvidence(e: DecisionEvidence): ReplayResult | null {
  if (!e || !(e.ladder in LADDERS) || !e.ctx || typeof e.ctx !== "object") return null
  const d = evaluate(e.ctx as never, LADDERS[e.ladder] as never)
  return {
    effect: d.effect,
    rule_id: d.ruleId,
    code: d.code,
    reason: d.reason,
    matches: d.effect === e.effect && (d.code ?? null) === (e.code ?? null) && d.ruleId === e.rule_id,
  }
}
