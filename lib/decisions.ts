// Typed decision codes for /authorize responses (UX-1).
//
// Agents replan reliably on a stable machine-readable `code` + `remediation`
// hint; they hallucinate on a bare 403 or free-text reason. These are derived
// purely from the persisted (status, decisionNote) so the same code is returned
// on idempotent replay — no schema column needed. Keep this in sync with the
// decisionNote strings written in app/api/v1/authorize/route.ts.

export type DecisionCode =
  | "ESCALATION_REQUIRED"
  | "NO_POLICY"
  | "CATEGORY_BLOCKED"
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "ESCALATION_CEILING_EXCEEDED"
  | "POLICY_DENIED"

export const REMEDIATION: Record<DecisionCode, string> = {
  ESCALATION_REQUIRED:
    "Over the auto-approve threshold; a human must approve. Poll request_id for status, or wait for the escalation to resolve.",
  NO_POLICY:
    "No spend policy is configured for this wallet. The owner must create one before purchases can be authorized.",
  CATEGORY_BLOCKED:
    "This category is on the wallet's blocked list. Use an allowed category or ask the owner to unblock it.",
  PER_TXN_LIMIT:
    "Amount exceeds the per-transaction limit. Split into smaller charges or ask the owner to raise the limit.",
  DAILY_BUDGET_EXCEEDED:
    "The wallet's daily spend budget is exhausted. Retry after the daily reset or ask the owner to raise the budget.",
  ESCALATION_CEILING_EXCEEDED:
    "Amount is above the escalation ceiling — too large for the agent to even request approval for. Lower the amount or have the owner raise escalate_over_usd / handle it out-of-band.",
  POLICY_DENIED: "Denied by policy. Review the reason and adjust the request.",
}

/** Map a persisted decision to a stable code. `undefined` for an approval. */
export function decisionCode(status: string, note: string | null): DecisionCode | undefined {
  if (status === "approved") return undefined
  if (status === "escalated") return "ESCALATION_REQUIRED"
  // denied
  if (!note) return "POLICY_DENIED"
  if (note === "No policy configured") return "NO_POLICY"
  if (note.startsWith("Category")) return "CATEGORY_BLOCKED"
  if (note.startsWith("Exceeds per-transaction")) return "PER_TXN_LIMIT"
  if (note === "Daily spend budget exceeded") return "DAILY_BUDGET_EXCEEDED"
  if (note.startsWith("Exceeds escalation ceiling")) return "ESCALATION_CEILING_EXCEEDED"
  return "POLICY_DENIED"
}

export type DecisionStatus = "approved" | "denied" | "escalated"

// Just the policy fields the decision engine reads (all monetary values in cents).
export interface PolicyView {
  autoApproveUnderUsd: number
  escalateOverUsd: number
  perTransactionMaxUsd: number
  dailySpendBudgetUsd: number
  blockedCategories: string[]
}

/**
 * Pure spend-authorization decision. Single source of truth for the live
 * /authorize path (called inside an advisory-locked transaction) AND dry-run
 * simulation. The returned `note` strings must stay in sync with decisionCode().
 *
 * Order: deny gates first (no-policy → blocked category → per-transaction cap →
 * daily budget), then the three-band sizing decision (ADR-0007):
 *   amount ≤ autoApproveUnder            → approve
 *   autoApproveUnder < amount ≤ escalate → escalate (human approval)
 *   amount > escalateOver                → deny (over the escalation ceiling)
 * Coherent policies satisfy autoApproveUnder ≤ escalateOver ≤ perTransactionMax.
 */
export function decide(input: {
  policy: PolicyView | null
  amountUsd: number
  category: string
  dailySpentUsd: number // already-approved spend today, excluding this request
}): { status: DecisionStatus; note: string | null } {
  const { policy, amountUsd, category, dailySpentUsd } = input
  if (!policy) return { status: "denied", note: "No policy configured" }

  const amountCents = Math.round(amountUsd * 100)
  if (policy.blockedCategories.includes(category)) {
    return { status: "denied", note: `Category '${category}' is blocked` }
  }
  if (amountCents > policy.perTransactionMaxUsd) {
    return { status: "denied", note: `Exceeds per-transaction limit of $${policy.perTransactionMaxUsd / 100}` }
  }
  const dailyTotalCents = Math.round((dailySpentUsd + amountUsd) * 100)
  if (dailyTotalCents > policy.dailySpendBudgetUsd) {
    return { status: "denied", note: "Daily spend budget exceeded" }
  }

  // Three-band sizing decision.
  if (amountCents <= policy.autoApproveUnderUsd) {
    return { status: "approved", note: "Auto-approved (under auto-approve threshold)" }
  }
  if (amountCents > policy.escalateOverUsd) {
    return { status: "denied", note: `Exceeds escalation ceiling of $${policy.escalateOverUsd / 100}` }
  }
  return { status: "escalated", note: "Over auto-approve threshold — requires human approval" }
}
