import { describe, expect, it } from "vitest"
import { evaluateLocally } from "../sdk/src/localPolicy"
import type { AuthorizeInput, DecisionCode, DecisionStatus, PolicyInput } from "../sdk/src/types"
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

type GoldenCase = {
  id: string
  policy: GoldenPolicy
  state: {
    dailySpentUsd: number
    execution: { valid: boolean; spentUsd: number; budgetUsd: number } | null
  }
  input: AuthorizeInput
  expected: {
    status: DecisionStatus
    code: DecisionCode | null
  }
}

type GoldenFixture = { cases: GoldenCase[] }

const UNSUPPORTED = new Set([
  "spend.monthly.exceeded.v1",
  "spend.exec.invalid-denies.v1",
  "spend.exec.budget-exceeded-denies.v1",
])

const cases = (fixture as GoldenFixture).cases.filter((c) => !UNSUPPORTED.has(c.id))

function toPolicy(c: GoldenCase): PolicyInput {
  return {
    dailySpendBudgetUsd: c.policy.dailySpendBudgetUsd,
    monthlySpendBudgetUsd: c.policy.monthlySpendBudgetUsd,
    perTransactionMaxUsd: c.policy.perTransactionMaxUsd,
    autoApproveUnderUsd: c.policy.autoApproveUnderUsd,
    escalateOverUsd: c.policy.escalateOverUsd,
    allowedCategories: c.policy.allowedCategories,
    blockedCategories: c.policy.blockedCategories,
  }
}

describe("golden spend policy corpus — SDK local fallback", () => {
  it("documents unsupported golden cases", () => {
    expect([...UNSUPPORTED]).toEqual([
      "spend.monthly.exceeded.v1",
      "spend.exec.invalid-denies.v1",
      "spend.exec.budget-exceeded-denies.v1",
    ])
  })

  it.each(cases)("$id", (c) => {
    const actual = evaluateLocally(toPolicy(c), c.input, c.state.dailySpentUsd)

    expect({
      status: actual.status,
      code: actual.code ?? null,
    }).toEqual({
      status: c.expected.status,
      code: c.expected.code,
    })
  })
})
