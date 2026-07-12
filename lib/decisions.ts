import { evaluate } from "@/lib/evaluation"
import { SPEND_LADDER } from "@/lib/rules/spend"
import { PROVISION_LADDER } from "@/lib/rules/provision"

// Typed decision codes for /authorize responses (UX-1).
//
// Agents replan reliably on a stable machine-readable `code` + `remediation`
// hint; they hallucinate on a bare 403 or free-text reason. These are derived
// purely from the persisted (status, decisionNote) so the same code is returned
// on idempotent replay — no schema column needed. Keep this in sync with the
// decisionNote strings written in app/api/v1/authorize/route.ts.

export type DecisionCode =
  | "ESCALATION_REQUIRED"
  | "ESCALATION_TIMED_OUT"
  | "NO_POLICY"
  | "CATEGORY_BLOCKED"
  | "CATEGORY_NOT_ALLOWED"
  | "RESOURCE_BLOCKED"
  | "RESOURCE_NOT_ALLOWED"
  | "AMOUNT_MISMATCH"
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "MONTHLY_BUDGET_EXCEEDED"
  | "SUBTREE_CAP_EXCEEDED"
  | "EXEC_BUDGET_EXCEEDED"
  | "COST_PER_OUTCOME_CEILING"
  | "WALLET_FROZEN"
  | "GRANT_NOT_FOUND"
  | "GRANT_ALREADY_USED"
  | "GRANT_EXPIRED"
  | "GRANT_MISMATCH"
  | "GRANT_UNSUPPORTED"
  | "POLICY_DENIED"

export const REMEDIATION: Record<DecisionCode, string> = {
  ESCALATION_REQUIRED:
    "Over the auto-approve threshold; a human must approve. Poll request_id for status, or wait for the escalation to resolve.",
  ESCALATION_TIMED_OUT:
    "The escalation passed its approval deadline and was auto-resolved by policy. Treat as denied; ask the owner to approve manually or raise the limit.",
  NO_POLICY:
    "No spend policy is configured for this wallet. The owner must create one before purchases can be authorized.",
  CATEGORY_BLOCKED:
    "This category is on the wallet's blocked list. Use an allowed category or ask the owner to unblock it.",
  CATEGORY_NOT_ALLOWED:
    "This category is not on the wallet's allow-list. Use an allowed category or ask the owner to add it.",
  RESOURCE_BLOCKED:
    "This resource is on the wallet's blocked list. Provision an allowed resource or ask the owner to unblock it.",
  RESOURCE_NOT_ALLOWED:
    "This resource is not on the wallet's resource allow-list. Provision an allowed resource or ask the owner to add it.",
  AMOUNT_MISMATCH:
    "quantity × unit_price_usd must equal amount_usd. Recompute the total and retry with consistent numbers.",
  PER_TXN_LIMIT:
    "Amount exceeds the per-transaction limit. Split into smaller charges or ask the owner to raise the limit.",
  DAILY_BUDGET_EXCEEDED:
    "The wallet's daily spend budget is exhausted. Retry after the daily reset or ask the owner to raise the budget.",
  MONTHLY_BUDGET_EXCEEDED:
    "The wallet's monthly spend budget is exhausted. Retry after the monthly reset or ask the owner to raise the monthly cap.",
  SUBTREE_CAP_EXCEEDED:
    "This wallet tree's daily spend cap is exhausted. Retry after the daily reset or ask the owner to raise the parent cap.",
  EXEC_BUDGET_EXCEEDED:
    "This execution's hard spend cap is reached. Request a new execution token with a higher budget, or finish within the cap.",
  COST_PER_OUTCOME_CEILING:
    "This wallet's cost per outcome is over its ceiling — the channel is throttled to human-gated spend. Wait for approval, improve the channel's efficiency, or ask the owner to raise the ceiling.",
  WALLET_FROZEN:
    "This wallet (or a parent wallet) is frozen — all agent actions are paused. Ask the owner to unfreeze it.",
  GRANT_NOT_FOUND: "Request a fresh approval. This grant does not exist for the current agent.",
  GRANT_ALREADY_USED: "Request a fresh approval. This grant has already been consumed.",
  GRANT_EXPIRED: "Request a fresh approval. This grant has expired.",
  GRANT_MISMATCH: "Retry with the exact action, amount, merchant, and category that the owner approved.",
  GRANT_UNSUPPORTED: "This grant type is not consumable by this endpoint.",
  POLICY_DENIED: "Denied by policy. Review the reason and adjust the request.",
}

export type PolicyDecision = { status: "approved" | "escalated" | "denied"; note: string }

export type DecideInput = {
  amountUsd: number
  category: string
  blockedCategories: string[]
  allowedCategories: string[]
  perTxnMaxCents: number
  dailySpentUsd: number
  dailyBudgetCents: number
  // Optional monthly cap. Omit both for no monthly limit (backward-compatible).
  monthlySpentUsd?: number
  monthlyBudgetCents?: number | null
  autoApproveUnderCents: number
  escalateOverCents: number
  // Cost-per-outcome ceiling state (CPO-1). Omit when the wallet has no ceiling
  // configured — the rule is then not applicable. Passing this keeps the shared
  // ladder (AuthZEN PDP) in lockstep with the native /authorize CPO throttle.
  cpo?: {
    ceilingCents: number
    windowSpendUsd: number
    windowOutcomes: number
    minOutcomes: number
  }
}

/**
 * The pure spend-decision ladder — no exec-token, no IO. Now a thin adapter over
 * the policy decision engine (ADR-0009): it runs the SPEND_LADDER rules and maps
 * the Decision back to this legacy shape. The live /authorize route runs the same
 * rules (plus the exec-budget gate) inside its advisory lock, so the two can no
 * longer drift. Notes here must match the strings `decisionCode` maps.
 *
 * Precedence: blocked → allow-list → per-txn → daily budget → floor-over-escalation
 * (at/under the auto-approve floor we never escalate).
 */
export function decidePolicy(i: DecideInput): PolicyDecision {
  const d = evaluate(
    {
      amountUsd: i.amountUsd,
      amountCents: Math.round(i.amountUsd * 100),
      category: i.category,
      blockedCategories: i.blockedCategories,
      allowedCategories: i.allowedCategories,
      perTxnMaxCents: i.perTxnMaxCents,
      dailySpentUsd: i.dailySpentUsd,
      dailyBudgetCents: i.dailyBudgetCents,
      monthlySpentUsd: i.monthlySpentUsd ?? 0,
      monthlyBudgetCents: i.monthlyBudgetCents ?? null,
      autoApproveUnderCents: i.autoApproveUnderCents,
      escalateOverCents: i.escalateOverCents,
      cpo: i.cpo,
    },
    SPEND_LADDER,
  )
  const status = d.effect === "allow" ? "approved" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, note: d.reason ?? "" }
}

export type ProvisionDecideInput = DecideInput & {
  resource: string
  blockedResources: string[]
  allowedResources: string[]
  escalateResources: string[]
}

/**
 * The pure provision-decision ladder — resource gate first, then the spend
 * dollar gates (a provision is spend). Same engine, same note/code contract:
 * the simulate path and the live /authorize/provision route run these rules.
 */
export function decideProvisionPolicy(i: ProvisionDecideInput): PolicyDecision {
  const d = evaluate(
    {
      amountUsd: i.amountUsd,
      amountCents: Math.round(i.amountUsd * 100),
      category: i.category,
      blockedCategories: i.blockedCategories,
      allowedCategories: i.allowedCategories,
      perTxnMaxCents: i.perTxnMaxCents,
      dailySpentUsd: i.dailySpentUsd,
      dailyBudgetCents: i.dailyBudgetCents,
      monthlySpentUsd: i.monthlySpentUsd ?? 0,
      monthlyBudgetCents: i.monthlyBudgetCents ?? null,
      autoApproveUnderCents: i.autoApproveUnderCents,
      escalateOverCents: i.escalateOverCents,
      cpo: i.cpo,
      resource: i.resource,
      blockedResources: i.blockedResources,
      allowedResources: i.allowedResources,
      escalateResources: i.escalateResources,
    },
    PROVISION_LADDER,
  )
  const status = d.effect === "allow" ? "approved" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, note: d.reason ?? "" }
}

/**
 * Replay code + remediation for tool/capability routes, factored out so the two
 * can't drift (Sprint Fearless F-1: they already had). An escalated row keeps
 * its domain-specific code + remediation; a settled row (incl. a timed-out
 * escalation) derives from the persisted note via `decisionCode`, so replay and
 * a fresh decision always agree.
 */
export function deriveReplayCode<T extends string>(
  status: string,
  note: string | null,
  escalated: { code: T; remediation: string },
): { code: T | DecisionCode | undefined; remediation: string | undefined } {
  if (status === "escalated") return { code: escalated.code, remediation: escalated.remediation }
  const settled = decisionCode(status, note)
  return { code: settled, remediation: settled ? REMEDIATION[settled] : undefined }
}

/** Map a persisted decision to a stable code. `undefined` for an approval. */
export function decisionCode(status: string, note: string | null): DecisionCode | undefined {
  if (status === "approved") return undefined
  // A CPO throttle is an escalation with its own stable code, so agents can
  // distinguish "over the auto-approve line" from "the channel is throttled".
  if (status === "escalated") return note === "Cost per outcome over ceiling" ? "COST_PER_OUTCOME_CEILING" : "ESCALATION_REQUIRED"
  // denied
  if (!note) return "POLICY_DENIED"
  if (note.startsWith("Escalation timed out")) return "ESCALATION_TIMED_OUT"
  if (note === "No policy configured") return "NO_POLICY"
  if (note.includes("not in the resource allow-list")) return "RESOURCE_NOT_ALLOWED"
  if (note.startsWith("Resource")) return "RESOURCE_BLOCKED"
  if (note.includes("not in the allow-list")) return "CATEGORY_NOT_ALLOWED"
  if (note.startsWith("Category")) return "CATEGORY_BLOCKED"
  if (note.startsWith("Exceeds per-transaction")) return "PER_TXN_LIMIT"
  if (note === "Daily spend budget exceeded") return "DAILY_BUDGET_EXCEEDED"
  if (note === "Monthly spend budget exceeded") return "MONTHLY_BUDGET_EXCEEDED"
  if (note === "Subtree daily spend cap exceeded") return "SUBTREE_CAP_EXCEEDED"
  if (note === "Execution budget exceeded") return "EXEC_BUDGET_EXCEEDED"
  if (note === "Wallet is frozen" || note.startsWith("Parent wallet is frozen")) return "WALLET_FROZEN"
  return "POLICY_DENIED"
}

// OBS-1: an observed row keeps its truthful would-be status; this marker in
// detailsJson says enforcement stood down. Shared by every authorize route so
// the response-wrapping semantics can't drift as observe reaches new surfaces.
export function isObserved(r: { detailsJson?: unknown }): boolean {
  return typeof r.detailsJson === "object" && r.detailsJson !== null && (r.detailsJson as { observed?: boolean }).observed === true
}
