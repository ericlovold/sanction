import { describe, expect, it } from "vitest"
import { decisionCode, type DecisionCode } from "../lib/decisions"
import { evaluate, type Obligation } from "../lib/evaluation"
import { SPEND_STATEFUL, SPEND_STATELESS, type SpendContext } from "../lib/rules/spend"
import fixture from "./fixtures/golden-policy/spend_authorize.v1.json"

type GoldenPolicy = {
  dailySpendBudgetUsd: number
  monthlySpendBudgetUsd: number | null
  perTransactionMaxUsd: number
  autoApproveUnderUsd: number
  escalateOverUsd: number
  allowedCategories: string[]
  blockedCategories: string[]
}

type GoldenObligation =
  | { type: "reserve_budget"; enforcement: "required" | "advisory"; scope: "agent" | "wallet_tree" }
  | { type: "human_approval"; enforcement: "required" | "advisory"; timeoutMins?: number; onTimeout?: "allow" | "deny" }
  | { type: string; enforcement: "required" | "advisory" }

type GoldenCase = {
  id: string
  policy: GoldenPolicy
  state: {
    dailySpentUsd: number
    monthlySpentUsd: number
    execution: { valid: boolean; spentUsd: number; budgetUsd: number } | null
  }
  input: {
    amountUsd: number
    category: string
  }
  expected: {
    authorized: boolean
    status: "approved" | "denied" | "escalated"
    code: DecisionCode | null
    reason: string | null
    obligations: GoldenObligation[]
  }
}

type GoldenFixture = { cases: GoldenCase[] }

function usdToCents(usd: number): number {
  return Math.round(usd * 100)
}

function toContext(c: GoldenCase): SpendContext {
  return {
    amountUsd: c.input.amountUsd,
    amountCents: usdToCents(c.input.amountUsd),
    category: c.input.category,
    blockedCategories: c.policy.blockedCategories,
    allowedCategories: c.policy.allowedCategories,
    perTxnMaxCents: usdToCents(c.policy.perTransactionMaxUsd),
    dailySpentUsd: c.state.dailySpentUsd,
    dailyBudgetCents: usdToCents(c.policy.dailySpendBudgetUsd),
    monthlySpentUsd: c.state.monthlySpentUsd,
    monthlyBudgetCents:
      c.policy.monthlySpendBudgetUsd === null ? null : usdToCents(c.policy.monthlySpendBudgetUsd),
    autoApproveUnderCents: usdToCents(c.policy.autoApproveUnderUsd),
    escalateOverCents: usdToCents(c.policy.escalateOverUsd),
    exec: c.state.execution ?? undefined,
  }
}

function normalizeObligations(obligations: Obligation[]): GoldenObligation[] {
  return obligations.map((o) => {
    if (o.type === "reserve_budget") {
      return { type: o.type, enforcement: o.enforcement, scope: o.scope }
    }
    if (o.type === "human_approval") {
      const out: GoldenObligation = { type: o.type, enforcement: o.enforcement }
      if (o.timeoutMins !== undefined) out.timeoutMins = o.timeoutMins
      if (o.onTimeout !== undefined) out.onTimeout = o.onTimeout
      return out
    }
    return { type: o.type, enforcement: o.enforcement }
  })
}

function decide(c: GoldenCase): GoldenCase["expected"] {
  const decision = evaluate(toContext(c), [...SPEND_STATELESS, ...SPEND_STATEFUL])
  const status =
    decision.effect === "allow" ? "approved" : decision.effect === "escalate" ? "escalated" : "denied"
  const reason = decision.reason ?? null

  return {
    authorized: status === "approved",
    status,
    code: decisionCode(status, reason) ?? null,
    reason,
    obligations: normalizeObligations(decision.obligations),
  }
}

describe("golden spend policy corpus — server decision engine", () => {
  it.each((fixture as GoldenFixture).cases)("$id", (c) => {
    expect(decide(c)).toEqual(c.expected)
  })
})
