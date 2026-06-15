import { describe, it, expect } from "vitest"
import { decisionCode, REMEDIATION, decide, type PolicyView } from "../lib/decisions"

// Mirrors the schema defaults (cents).
const policy: PolicyView = {
  blockedCategories: ["gambling", "adult", "crypto"],
  perTransactionMaxUsd: 5000, // $50
  dailySpendBudgetUsd: 5000, // $50
  escalateOverUsd: 10000, // $100 (above per-txn here, so escalation needs a higher per-txn cap)
}

describe("decide (spend authorization engine)", () => {
  it("denies when no policy is configured", () => {
    expect(decide({ policy: null, amountUsd: 1, category: "software", dailySpentUsd: 0 }))
      .toEqual({ status: "denied", note: "No policy configured" })
  })

  it("denies a blocked category", () => {
    expect(decide({ policy, amountUsd: 1, category: "gambling", dailySpentUsd: 0 }).status).toBe("denied")
    expect(decisionCode("denied", "Category 'gambling' is blocked")).toBe("CATEGORY_BLOCKED")
  })

  it("denies over the per-transaction limit", () => {
    const d = decide({ policy, amountUsd: 60, category: "software", dailySpentUsd: 0 })
    expect(d.status).toBe("denied")
    expect(d.note).toContain("per-transaction")
  })

  it("denies when the daily budget would be exceeded", () => {
    const d = decide({ policy, amountUsd: 40, category: "software", dailySpentUsd: 20 })
    expect(d).toEqual({ status: "denied", note: "Daily spend budget exceeded" })
  })

  it("approves within all limits", () => {
    expect(decide({ policy, amountUsd: 10, category: "software", dailySpentUsd: 0 }))
      .toEqual({ status: "approved", note: "Auto-approved by policy" })
  })

  it("escalates over the escalation threshold (when per-txn allows)", () => {
    const p: PolicyView = { ...policy, perTransactionMaxUsd: 50000, dailySpendBudgetUsd: 50000 }
    expect(decide({ policy: p, amountUsd: 150, category: "software", dailySpentUsd: 0 }).status).toBe("escalated")
  })

  it("every note decide() emits maps to a remediation-backed code", () => {
    const notes = [
      decide({ policy: null, amountUsd: 1, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 1, category: "gambling", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 60, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 40, category: "x", dailySpentUsd: 20 }),
    ]
    for (const { status, note } of notes) {
      const code = decisionCode(status, note)
      expect(code && REMEDIATION[code]).toBeTruthy()
    }
  })
})

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
    expect(decisionCode("denied", "Exceeds per-transaction limit of $50")).toBe("PER_TXN_LIMIT")
    expect(decisionCode("denied", "Daily spend budget exceeded")).toBe("DAILY_BUDGET_EXCEEDED")
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
      decisionCode("denied", "Exceeds per-transaction limit of $50"),
      decisionCode("denied", "Daily spend budget exceeded"),
      decisionCode("denied", null),
    ]
    for (const c of codes) {
      expect(c && REMEDIATION[c]).toBeTruthy()
    }
  })
})
