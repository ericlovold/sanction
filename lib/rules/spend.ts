// Spend rules — the reference implementation of the policy decision engine
// (ADR-0009). Each rule reproduces one gate of the existing /authorize ladder,
// returning the exact same decision code + note strings the API contract and
// tests depend on. Pure over SpendContext; the route pre-fetches budget state
// into the context (daily spend, execution-token state) before the stateful
// rules run inside the advisory lock.

import { allow, type Rule, type Obligation } from "@/lib/evaluation"

export type SpendContext = {
  amountUsd: number
  amountCents: number
  category: string
  blockedCategories: string[]
  allowedCategories: string[]
  perTxnMaxCents: number
  dailySpentUsd: number
  dailyBudgetCents: number
  // Monthly cap is opt-in: null = no monthly limit. monthlySpentUsd is the
  // agent's approved spend so far this calendar month (read under the lock).
  monthlySpentUsd: number
  monthlyBudgetCents: number | null
  autoApproveUnderCents: number
  escalateOverCents: number
  // Execution-token state (live route only; undefined when the agent presented no exec JWT).
  exec?: { valid: boolean; spentUsd: number; budgetUsd: number }
  // Escalation obligation parameters (live route only; from the wallet policy).
  escalationTimeoutMins?: number
  escalationTimeoutAction?: "approve" | "deny"
}

// On approval, reserve the charge against the execution budget — the exec-token
// debit. Emitted whenever we approve; the route honors it only when an exec
// token is present (PEP capability, per ADR-0009).
function reserveBudget(c: SpendContext): Obligation[] {
  return [{ type: "reserve_budget", enforcement: "required", scope: "agent", amountCents: c.amountCents }]
}

export function humanApproval(c: SpendContext): Obligation[] {
  return [
    {
      type: "human_approval",
      enforcement: "required",
      timeoutMins: c.escalationTimeoutMins,
      onTimeout: c.escalationTimeoutAction === "approve" ? "allow" : c.escalationTimeoutAction === "deny" ? "deny" : undefined,
    },
  ]
}

export const categoryRule: Rule<SpendContext> = {
  id: "category",
  run(c) {
    if (c.blockedCategories.includes(c.category)) {
      return { effect: "deny", ruleId: "category", code: "CATEGORY_BLOCKED", reason: `Category '${c.category}' is blocked` }
    }
    if (c.allowedCategories.length > 0 && !c.allowedCategories.includes(c.category)) {
      return { effect: "deny", ruleId: "category", code: "CATEGORY_NOT_ALLOWED", reason: `Category '${c.category}' is not in the allow-list` }
    }
    return allow("category")
  },
}

export const perTransactionRule: Rule<SpendContext> = {
  id: "per_transaction",
  run(c) {
    if (c.amountCents > c.perTxnMaxCents) {
      return { effect: "deny", ruleId: "per_transaction", code: "PER_TXN_LIMIT", reason: `Exceeds per-transaction limit of $${c.perTxnMaxCents / 100}` }
    }
    return allow("per_transaction")
  },
}

export const dailyBudgetRule: Rule<SpendContext> = {
  id: "daily_budget",
  run(c) {
    // Sum dollars then round, matching the live daily-budget comparison exactly.
    if (Math.round((c.dailySpentUsd + c.amountUsd) * 100) > c.dailyBudgetCents) {
      return { effect: "deny", ruleId: "daily_budget", code: "DAILY_BUDGET_EXCEEDED", reason: "Daily spend budget exceeded" }
    }
    return allow("daily_budget")
  },
}

export const monthlyBudgetRule: Rule<SpendContext> = {
  id: "monthly_budget",
  run(c) {
    if (c.monthlyBudgetCents === null) return allow("monthly_budget") // opt-in; no cap set
    // Sum dollars then round, mirroring the daily-budget comparison exactly.
    if (Math.round((c.monthlySpentUsd + c.amountUsd) * 100) > c.monthlyBudgetCents) {
      return { effect: "deny", ruleId: "monthly_budget", code: "MONTHLY_BUDGET_EXCEEDED", reason: "Monthly spend budget exceeded" }
    }
    return allow("monthly_budget")
  },
}

export const executionBudgetRule: Rule<SpendContext> = {
  id: "execution_budget",
  run(c) {
    if (!c.exec) return allow("execution_budget") // no exec token → not applicable
    if (!c.exec.valid) {
      // No stable code — falls through to POLICY_DENIED, matching prior behavior.
      return { effect: "deny", ruleId: "execution_budget", reason: "Execution token expired or revoked" }
    }
    if (Math.round((c.exec.spentUsd + c.amountUsd) * 100) > Math.round(c.exec.budgetUsd * 100)) {
      return { effect: "deny", ruleId: "execution_budget", code: "EXEC_BUDGET_EXCEEDED", reason: "Execution budget exceeded" }
    }
    return allow("execution_budget")
  },
}

// The spend ladder terminal: floor wins over escalation; the auto-approve floor
// is a silent approve that never escalates even when over the escalate line.
export const ladderRule: Rule<SpendContext> = {
  id: "ladder",
  run(c) {
    if (c.amountCents <= c.autoApproveUnderCents) {
      return allow("ladder", "Auto-approved (under auto-approve floor)", reserveBudget(c))
    }
    if (c.amountCents > c.escalateOverCents) {
      return { effect: "escalate", ruleId: "ladder", code: "ESCALATION_REQUIRED", reason: "Exceeds escalation threshold", obligations: humanApproval(c) }
    }
    return allow("ladder", "Auto-approved by policy", reserveBudget(c))
  },
}

// The pure ladder (no execution-token gate) — the simulate path + decidePolicy.
export const SPEND_LADDER: Rule<SpendContext>[] = [categoryRule, perTransactionRule, dailyBudgetRule, monthlyBudgetRule, ladderRule]

// Live route: stateless gates run before the advisory lock…
export const SPEND_STATELESS: Rule<SpendContext>[] = [categoryRule, perTransactionRule]

// …and the stateful gates + ladder run inside it, against budget state read under the lock.
export const SPEND_STATEFUL: Rule<SpendContext>[] = [dailyBudgetRule, monthlyBudgetRule, executionBudgetRule, ladderRule]
