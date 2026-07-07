import { describe, it, expect } from "vitest"
import { evaluate } from "@/lib/evaluation"
import { costPerOutcomeRule, COST_PER_OUTCOME_NOTE, SPEND_STATEFUL, type SpendContext } from "@/lib/rules/spend"
import { decisionCode } from "@/lib/decisions"

// CPO-1: the cost-per-outcome ceiling. The property under test: a channel over
// its CAC line escalates every further charge — including sub-floor ones — and
// never silently denies; under the min-outcome sample it stays out of the way.

function ctx(overrides: Partial<SpendContext> = {}): SpendContext {
  return {
    amountUsd: 20,
    amountCents: 2000,
    category: "services",
    blockedCategories: [],
    allowedCategories: [],
    perTxnMaxCents: 100_000,
    dailySpentUsd: 0,
    dailyBudgetCents: 1_000_000,
    monthlySpentUsd: 0,
    monthlyBudgetCents: null,
    autoApproveUnderCents: 5_000,
    escalateOverCents: 50_000,
    ...overrides,
  }
}

describe("costPerOutcomeRule", () => {
  it("not applicable without a configured ceiling", () => {
    expect(costPerOutcomeRule.run(ctx()).effect).toBe("allow")
  })

  it("stays out of the way under the min-outcome sample (cold start)", () => {
    const c = ctx({ cpo: { ceilingCents: 30_000, windowSpendUsd: 10_000, windowOutcomes: 3, minOutcomes: 5 } })
    expect(costPerOutcomeRule.run(c).effect).toBe("allow")
  })

  it("allows while projected cost-per-outcome is at or under the ceiling", () => {
    // 10 outcomes at $300 ceiling = $3000 allowance; $2980 spent + $20 = exactly at ceiling
    const c = ctx({ cpo: { ceilingCents: 30_000, windowSpendUsd: 2980, windowOutcomes: 10, minOutcomes: 5 } })
    expect(costPerOutcomeRule.run(c).effect).toBe("allow")
  })

  it("escalates when this charge would push cost-per-outcome over the ceiling", () => {
    const c = ctx({ cpo: { ceilingCents: 30_000, windowSpendUsd: 2990, windowOutcomes: 10, minOutcomes: 5 } })
    const r = costPerOutcomeRule.run(c)
    expect(r.effect).toBe("escalate")
    expect(r.code).toBe("COST_PER_OUTCOME_CEILING")
    expect(r.reason).toBe(COST_PER_OUTCOME_NOTE)
    expect(r.obligations?.some((o) => o.type === "human_approval")).toBe(true)
  })

  it("the throttle gates even sub-floor charges — no silent lane on a breached channel", () => {
    // $1 charge, well under the $50 auto-approve floor — still escalates.
    const c = ctx({
      amountUsd: 1,
      amountCents: 100,
      cpo: { ceilingCents: 30_000, windowSpendUsd: 3100, windowOutcomes: 10, minOutcomes: 5 },
    })
    const d = evaluate(c, SPEND_STATEFUL)
    expect(d.effect).toBe("escalate")
    expect(d.code).toBe("COST_PER_OUTCOME_CEILING")
  })

  it("a healthy channel still auto-approves through the full stateful ladder", () => {
    const c = ctx({
      amountUsd: 1,
      amountCents: 100,
      cpo: { ceilingCents: 30_000, windowSpendUsd: 100, windowOutcomes: 10, minOutcomes: 5 },
    })
    expect(evaluate(c, SPEND_STATEFUL).effect).toBe("allow")
  })
})

describe("decision codes (CPO + freeze)", () => {
  it("an escalated row with the CPO note replays as COST_PER_OUTCOME_CEILING", () => {
    expect(decisionCode("escalated", COST_PER_OUTCOME_NOTE)).toBe("COST_PER_OUTCOME_CEILING")
  })
  it("a plain escalation still replays as ESCALATION_REQUIRED", () => {
    expect(decisionCode("escalated", null)).toBe("ESCALATION_REQUIRED")
  })
  it("frozen denials replay as WALLET_FROZEN (self and ancestor)", () => {
    expect(decisionCode("denied", "Wallet is frozen")).toBe("WALLET_FROZEN")
    expect(decisionCode("denied", "Parent wallet is frozen")).toBe("WALLET_FROZEN")
  })
})
