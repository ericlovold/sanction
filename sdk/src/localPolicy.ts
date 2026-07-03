import type { AuthorizeInput, Decision, DecisionStatus, PolicyInput } from "./types"

// Local mirror of the server's /authorize decision order, used when Sanction is
// unreachable. Kept in lockstep with lib/rules/spend.ts (the SPEND_LADDER):
//   1. blocked category            -> denied    (CATEGORY_BLOCKED)
//   2. allowlist (if non-empty)    -> denied    (CATEGORY_NOT_ALLOWED)
//   3. over per-transaction max    -> denied    (PER_TXN_LIMIT)
//   4. daily budget would exceed   -> denied    (DAILY_BUDGET_EXCEEDED)
//   5. at/under auto-approve floor -> approved  (floor wins over escalation)
//   6. over escalation threshold   -> escalated (ESCALATION_REQUIRED)
//   7. otherwise                   -> approved
// Pure + synchronous so it is trivially testable. Amounts are DOLLARS, matching
// PolicyInput. Monthly and subtree caps are server-only — not enforced locally
// (a degraded fallback tracks daily spend for this process only).
export function evaluateLocally(
  policy: PolicyInput,
  input: AuthorizeInput,
  dailySpentUsd: number,
): { status: DecisionStatus; code?: Decision["code"]; reason: string } {
  const amount = input.amountUsd
  const cents = (n: number) => Math.round(n * 100)

  if (policy.blockedCategories?.includes(input.category)) {
    return { status: "denied", code: "CATEGORY_BLOCKED", reason: `Category '${input.category}' is blocked` }
  }
  if (policy.allowedCategories && policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(input.category)) {
    return { status: "denied", code: "CATEGORY_NOT_ALLOWED", reason: `Category '${input.category}' is not in the allow-list` }
  }
  if (policy.perTransactionMaxUsd != null && amount > policy.perTransactionMaxUsd) {
    return { status: "denied", code: "PER_TXN_LIMIT", reason: `Exceeds per-transaction limit of $${policy.perTransactionMaxUsd}` }
  }
  if (policy.dailySpendBudgetUsd != null && cents(dailySpentUsd + amount) > cents(policy.dailySpendBudgetUsd)) {
    return { status: "denied", code: "DAILY_BUDGET_EXCEEDED", reason: "Daily spend budget exceeded" }
  }
  if (policy.autoApproveUnderUsd != null && amount <= policy.autoApproveUnderUsd) {
    return { status: "approved", reason: "Auto-approved (under auto-approve floor)" }
  }
  if (policy.escalateOverUsd != null && amount > policy.escalateOverUsd) {
    return { status: "escalated", code: "ESCALATION_REQUIRED", reason: "Requires human approval" }
  }
  return { status: "approved", reason: "Auto-approved by local policy" }
}

let localCounter = 0
/** Build a Decision from a local evaluation, marked so callers know it wasn't remote. */
export function localDecision(
  ev: { status: DecisionStatus; code?: Decision["code"]; reason: string },
  input: AuthorizeInput,
): Decision {
  return {
    authorized: ev.status === "approved",
    status: ev.status,
    requestId: `local_${Date.now()}_${localCounter++}`,
    reason: ev.reason,
    code: ev.code,
    remediation: ev.status === "denied" ? "Decided locally while Sanction was unreachable." : undefined,
    agent: "(local)",
    amountUsd: input.amountUsd,
    merchant: input.merchant,
    decidedLocally: true,
  }
}
