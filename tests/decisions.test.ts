import { describe, it, expect } from "vitest"
import { decisionCode, decidePolicy, REMEDIATION } from "../lib/decisions"

describe("decisionCode (UX-1 typed DENY)", () => {
  it("returns no code for an approval", () => {
    expect(decisionCode("approved", "Auto-approved by policy")).toBeUndefined()
  })

  it("maps escalation", () => {
    expect(decisionCode("escalated", null)).toBe("ESCALATION_REQUIRED")
  })

  it("maps each denial note to its stable code", () => {
    expect(decisionCode("denied", "No policy configured")).toBe("NO_POLICY")
    expect(decisionCode("denied", "Category 'gambling' is blocked")).toBe("CATEGORY_BLOCKED")
    expect(decisionCode("denied", "Category 'marketing' is not in the allow-list")).toBe("CATEGORY_NOT_ALLOWED")
    expect(decisionCode("denied", "Exceeds per-transaction limit of $50")).toBe("PER_TXN_LIMIT")
    expect(decisionCode("denied", "Daily spend budget exceeded")).toBe("DAILY_BUDGET_EXCEEDED")
    expect(decisionCode("denied", "Monthly spend budget exceeded")).toBe("MONTHLY_BUDGET_EXCEEDED")
    expect(decisionCode("denied", "Subtree daily spend cap exceeded")).toBe("SUBTREE_CAP_EXCEEDED")
  })

  it("disambiguates blocked vs not-allowed categories (both start with 'Category')", () => {
    expect(decisionCode("denied", "Category 'crypto' is blocked")).toBe("CATEGORY_BLOCKED")
    expect(decisionCode("denied", "Category 'crypto' is not in the allow-list")).toBe("CATEGORY_NOT_ALLOWED")
  })

  it("falls back to POLICY_DENIED for an unknown/empty note", () => {
    expect(decisionCode("denied", null)).toBe("POLICY_DENIED")
    expect(decisionCode("denied", "something new")).toBe("POLICY_DENIED")
  })

  it("has a remediation hint for every code it can emit", () => {
    const codes = [
      decisionCode("escalated", null),
      decisionCode("denied", "No policy configured"),
      decisionCode("denied", "Category 'x' is blocked"),
      decisionCode("denied", "Category 'x' is not in the allow-list"),
      decisionCode("denied", "Exceeds per-transaction limit of $50"),
      decisionCode("denied", "Daily spend budget exceeded"),
      decisionCode("denied", "Monthly spend budget exceeded"),
      decisionCode("denied", "Subtree daily spend cap exceeded"),
      decisionCode("denied", null),
    ]
    for (const c of codes) {
      expect(c && REMEDIATION[c]).toBeTruthy()
    }
  })
})

describe("decidePolicy — monthly cap (opt-in)", () => {
  // Bands: auto-approve < $10, escalate > $50, per-txn cap $100, daily budget $1000.
  const base = {
    category: "software",
    blockedCategories: [] as string[],
    allowedCategories: [] as string[],
    perTxnMaxCents: 10_000,
    dailySpentUsd: 0,
    dailyBudgetCents: 100_000,
    autoApproveUnderCents: 1_000,
    escalateOverCents: 5_000,
  }

  it("denies when the month-to-date + this charge would exceed the monthly cap", () => {
    const d = decidePolicy({ ...base, amountUsd: 5, monthlySpentUsd: 798, monthlyBudgetCents: 80_000 }) // $798 + $5 > $800
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("MONTHLY_BUDGET_EXCEEDED")
  })

  it("approves under the monthly cap", () => {
    const d = decidePolicy({ ...base, amountUsd: 5, monthlySpentUsd: 100, monthlyBudgetCents: 80_000 })
    expect(d.status).toBe("approved")
  })

  it("treats a null/absent monthly cap as no limit", () => {
    const d = decidePolicy({ ...base, amountUsd: 5, monthlySpentUsd: 999_999, monthlyBudgetCents: null })
    expect(d.status).toBe("approved")
    const d2 = decidePolicy({ ...base, amountUsd: 5, monthlySpentUsd: 999_999 }) // monthly omitted
    expect(d2.status).toBe("approved")
  })
})
