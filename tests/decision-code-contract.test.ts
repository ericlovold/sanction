import { describe, it, expect } from "vitest"
import { evaluate, type Decision } from "@/lib/evaluation"
import { SPEND_STATELESS, SPEND_STATEFUL, type SpendContext } from "@/lib/rules/spend"
import { PROVISION_STATELESS, PROVISION_STATEFUL, type ProvisionContext } from "@/lib/rules/provision"

// The exact rule composition the live routes run (authorize/route.ts runs
// STATELESS as the pre-lock gate, then the full list inside the lock) —
// includes executionBudgetRule, which the simulate/PDP LADDER variant omits.
const LIVE_SPEND = [...SPEND_STATELESS, ...SPEND_STATEFUL]
const LIVE_PROVISION = [...PROVISION_STATELESS, ...PROVISION_STATEFUL]
import { decisionCode, REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { WALLET_FROZEN_NOTE, PARENT_FROZEN_NOTE } from "@/lib/freeze"

// The decision-code contract: agents replan on stable machine codes, but the
// code is not persisted — replay re-derives it from the saved (status, note)
// via decisionCode()'s string matching, while a fresh decision carries the
// rule's own `code`. Nothing structural stops a reworded rule reason from
// silently breaking replay. This suite closes that hole: it drives the REAL
// ladders into every deny/escalate outcome and asserts the note-derived code
// equals the code the rule emitted. Reword a reason string in lib/rules/*
// without updating decisionCode() and the round-trip fails here, not in an
// agent's replan loop.

const base: SpendContext = {
  amountUsd: 10,
  amountCents: 1000,
  category: "software",
  blockedCategories: [],
  allowedCategories: [],
  perTxnMaxCents: 100_000,
  dailySpentUsd: 0,
  dailyBudgetCents: 100_000,
  monthlySpentUsd: 0,
  monthlyBudgetCents: null,
  autoApproveUnderCents: 5_000,
  escalateOverCents: 50_000,
}

const provisionBase: ProvisionContext = {
  ...base,
  resource: "azure.seat",
  blockedResources: [],
  allowedResources: [],
  escalateResources: [],
}

function statusOf(d: Decision): string {
  return d.effect === "allow" ? "approved" : d.effect === "escalate" ? "escalated" : "denied"
}

function roundTrip(d: Decision) {
  expect(d.effect).not.toBe("allow")
  expect(d.code).toBeDefined()
  // The persisted note re-derives to the exact code the rule emitted.
  expect(decisionCode(statusOf(d), d.reason ?? null)).toBe(d.code)
  // And every code an agent can see has a remediation hint.
  expect(REMEDIATION[d.code as DecisionCode]).toBeTruthy()
}

describe("spend ladder — every outcome's note re-derives to its own code", () => {
  const cases: [DecisionCode, SpendContext][] = [
    ["CATEGORY_BLOCKED", { ...base, blockedCategories: ["software"] }],
    ["CATEGORY_NOT_ALLOWED", { ...base, allowedCategories: ["services"] }],
    ["PER_TXN_LIMIT", { ...base, perTxnMaxCents: 500 }],
    ["DAILY_BUDGET_EXCEEDED", { ...base, dailyBudgetCents: 500 }],
    ["MONTHLY_BUDGET_EXCEEDED", { ...base, monthlySpentUsd: 10, monthlyBudgetCents: 1_500 }],
    ["EXEC_BUDGET_EXCEEDED", { ...base, exec: { valid: true, spentUsd: 95, budgetUsd: 100 } }],
    [
      "COST_PER_OUTCOME_CEILING",
      { ...base, cpo: { ceilingCents: 100, windowSpendUsd: 100, windowOutcomes: 10, minOutcomes: 5 } },
    ],
    ["ESCALATION_REQUIRED", { ...base, amountUsd: 600, amountCents: 60_000 }],
  ]

  it.each(cases)("%s", (code, ctx) => {
    const d = evaluate(ctx, LIVE_SPEND)
    expect(d.code).toBe(code)
    roundTrip(d)
  })
})

describe("provision ladder — the resource gate round-trips too", () => {
  const cases: [DecisionCode, ProvisionContext][] = [
    ["RESOURCE_BLOCKED", { ...provisionBase, blockedResources: ["azure.seat"] }],
    ["RESOURCE_NOT_ALLOWED", { ...provisionBase, allowedResources: ["m365.license"] }],
    ["ESCALATION_REQUIRED", { ...provisionBase, escalateResources: ["azure.seat"] }],
  ]

  it.each(cases)("%s", (code, ctx) => {
    const d = evaluate(ctx, LIVE_PROVISION)
    expect(d.code).toBe(code)
    roundTrip(d)
  })
})

describe("shell-written notes — strings minted outside the ladders still derive", () => {
  it("freeze notes (both shapes) derive WALLET_FROZEN", () => {
    expect(decisionCode("denied", WALLET_FROZEN_NOTE)).toBe("WALLET_FROZEN")
    expect(decisionCode("denied", `${PARENT_FROZEN_NOTE} 'ops' — all descendant activity is paused`)).toBe(
      "WALLET_FROZEN",
    )
  })
})
