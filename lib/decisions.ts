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
  | "EXEC_BUDGET_EXCEEDED"
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
  EXEC_BUDGET_EXCEEDED:
    "This execution's hard spend cap is reached. Request a new execution token with a higher budget, or finish within the cap.",
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
  if (note === "Execution budget exceeded") return "EXEC_BUDGET_EXCEEDED"
  return "POLICY_DENIED"
}
