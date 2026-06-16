import { describe, it, expect } from "vitest"
import { decisionCode, REMEDIATION, decide, type PolicyView } from "../lib/decisions"

// Coherent "balanced" thresholds (cents): autoApprove $25 ≤ escalate $75 ≤ perTxn $100 ≤ daily $200.
const policy: PolicyView = {
  autoApproveUnderUsd: 2500,
  escalateOverUsd: 7500,
  perTransactionMaxUsd: 10000,
  dailySpendBudgetUsd: 20000,
  blockedCategories: ["gambling", "adult", "crypto"],
}

describe("decide (three-band spend authorization engine)", () => {
  it("denies when no policy is configured", () => {
    expect(decide({ policy: null, amountUsd: 1, category: "software", dailySpentUsd: 0 }))
      .toEqual({ status: "denied", note: "No policy configured" })
  })

  it("denies a blocked category", () => {
    expect(decide({ policy, amountUsd: 1, category: "gambling", dailySpentUsd: 0 }).status).toBe("denied")
    expect(decisionCode("denied", "Category 'gambling' is blocked")).toBe("CATEGORY_BLOCKED")
  })

  it("denies over the per-transaction limit ($100)", () => {
    const d = decide({ policy, amountUsd: 150, category: "software", dailySpentUsd: 0 })
    expect(d.status).toBe("denied")
    expect(d.note).toContain("per-transaction")
  })

  it("denies when the daily budget would be exceeded", () => {
    const d = decide({ policy, amountUsd: 10, category: "software", dailySpentUsd: 195 })
    expect(d).toEqual({ status: "denied", note: "Daily spend budget exceeded" })
  })

  // Three bands:
  it("approves at/under the auto-approve threshold ($25)", () => {
    expect(decide({ policy, amountUsd: 10, category: "software", dailySpentUsd: 0 }))
      .toEqual({ status: "approved", note: "Auto-approved (under auto-approve threshold)" })
  })

  it("escalates in the middle band ($25 < amount ≤ $75)", () => {
    expect(decide({ policy, amountUsd: 50, category: "software", dailySpentUsd: 0 }).status).toBe("escalated")
  })

  it("denies above the escalation ceiling ($75 < amount ≤ perTxn $100)", () => {
    const d = decide({ policy, amountUsd: 80, category: "software", dailySpentUsd: 0 })
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("ESCALATION_CEILING_EXCEEDED")
  })

  it("respects band boundaries exactly ($25 approves, $75 escalates)", () => {
    expect(decide({ policy, amountUsd: 25, category: "software", dailySpentUsd: 0 }).status).toBe("approved")
    expect(decide({ policy, amountUsd: 75, category: "software", dailySpentUsd: 0 }).status).toBe("escalated")
  })

  it("every note decide() emits maps to a remediation-backed code", () => {
    const outcomes = [
      decide({ policy: null, amountUsd: 1, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 1, category: "gambling", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 150, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 10, category: "x", dailySpentUsd: 195 }),
      decide({ policy, amountUsd: 10, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 50, category: "x", dailySpentUsd: 0 }),
      decide({ policy, amountUsd: 80, category: "x", dailySpentUsd: 0 }),
    ]
    for (const { status, note } of outcomes) {
      const code = decisionCode(status, note)
      if (status === "approved") expect(code).toBeUndefined()
      else expect(code && REMEDIATION[code]).toBeTruthy()
    }
  })
})

describe("decisionCode (UX-1 typed DENY)", () => {
  it("returns no code for an approval", () => {
    expect(decisionCode("approved", "Auto-approved (under auto-approve threshold)")).toBeUndefined()
  })

  it("maps escalation", () => {
    expect(decisionCode("escalated", "Over auto-approve threshold — requires human approval")).toBe("ESCALATION_REQUIRED")
  })

  it("maps each denial note to its stable code", () => {
    expect(decisionCode("denied", "No policy configured")).toBe("NO_POLICY")
    expect(decisionCode("denied", "Category 'gambling' is blocked")).toBe("CATEGORY_BLOCKED")
    expect(decisionCode("denied", "Exceeds per-transaction limit of $100")).toBe("PER_TXN_LIMIT")
    expect(decisionCode("denied", "Daily spend budget exceeded")).toBe("DAILY_BUDGET_EXCEEDED")
    expect(decisionCode("denied", "Exceeds escalation ceiling of $75")).toBe("ESCALATION_CEILING_EXCEEDED")
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
