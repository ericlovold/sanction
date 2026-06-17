import type { AuthorizeInput, Decision, DecisionStatus, PolicyInput } from "./types"

// Local mirror of the server's /authorize decision order, used when Sanction is
// unreachable. Kept deliberately in lockstep with app/api/v1/authorize/route.ts:
//   1. blocked category            -> denied
//   2. allowlist (if non-empty)    -> denied when category not listed
//   3. over per-transaction max    -> denied
//   4. daily budget would exceed   -> denied
//   5. over escalation threshold   -> escalated
//   6. otherwise                   -> approved
// Pure + synchronous so it is trivially testable. Amounts are integer cents.
export function evaluateLocally(
  policy: PolicyInput,
  input: AuthorizeInput,
  dailySpentCents: number,
): { status: DecisionStatus; code?: Decision["code"]; reason: string } {
  const amountCents = Math.round(input.amountUsd * 100)

  if (policy.blockedCategories?.includes(input.category)) {
    return { status: "denied", code: "CATEGORY_BLOCKED", reason: `Category '${input.category}' is blocked` }
  }
  if (policy.allowedCategories && policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(input.category)) {
    return { status: "denied", code: "POLICY_DENIED", reason: `Category '${input.category}' is not on the allowed-categories list` }
  }
  if (policy.perTransactionMaxUsd != null && amountCents > policy.perTransactionMaxUsd) {
    return { status: "denied", code: "PER_TXN_LIMIT", reason: `Exceeds per-transaction limit of $${policy.perTransactionMaxUsd / 100}` }
  }
  if (policy.dailySpendBudgetUsd != null && dailySpentCents + amountCents > policy.dailySpendBudgetUsd) {
    return { status: "denied", code: "DAILY_BUDGET_EXCEEDED", reason: "Daily spend budget exceeded" }
  }
  if (policy.escalateOverUsd != null && amountCents > policy.escalateOverUsd) {
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
