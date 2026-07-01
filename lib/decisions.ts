import { evaluate } from "@/lib/evaluation"
import { SPEND_LADDER } from "@/lib/rules/spend"

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
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "SUBTREE_CAP_EXCEEDED"
  | "EXEC_BUDGET_EXCEEDED"
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
  PER_TXN_LIMIT:
    "Amount exceeds the per-transaction limit. Split into smaller charges or ask the owner to raise the limit.",
  DAILY_BUDGET_EXCEEDED:
    "The wallet's daily spend budget is exhausted. Retry after the daily reset or ask the owner to raise the budget.",
  SUBTREE_CAP_EXCEEDED:
    "This wallet tree's daily spend cap is exhausted. Retry after the daily reset or ask the owner to raise the parent cap.",
  EXEC_BUDGET_EXCEEDED:
    "This execution's hard spend cap is reached. Request a new execution token with a higher budget, or finish within the cap.",
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
  autoApproveUnderCents: number
  escalateOverCents: number
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
      autoApproveUnderCents: i.autoApproveUnderCents,
      escalateOverCents: i.escalateOverCents,
    },
    SPEND_LADDER,
  )
  const status = d.effect === "allow" ? "approved" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, note: d.reason ?? "" }
}

/** Map a persisted decision to a stable code. `undefined` for an approval. */
export function decisionCode(status: string, note: string | null): DecisionCode | undefined {
  if (status === "approved") return undefined
  if (status === "escalated") return "ESCALATION_REQUIRED"
  // denied
  if (!note) return "POLICY_DENIED"
  if (note.startsWith("Escalation timed out")) return "ESCALATION_TIMED_OUT"
  if (note === "No policy configured") return "NO_POLICY"
  if (note.includes("not in the allow-list")) return "CATEGORY_NOT_ALLOWED"
  if (note.startsWith("Category")) return "CATEGORY_BLOCKED"
  if (note.startsWith("Exceeds per-transaction")) return "PER_TXN_LIMIT"
  if (note === "Daily spend budget exceeded") return "DAILY_BUDGET_EXCEEDED"
  if (note === "Subtree daily spend cap exceeded") return "SUBTREE_CAP_EXCEEDED"
  if (note === "Execution budget exceeded") return "EXEC_BUDGET_EXCEEDED"
  return "POLICY_DENIED"
}
