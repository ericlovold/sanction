import { describe, it, expect } from "vitest"
import { decidePolicy, decisionCode, type DecideInput } from "../lib/decisions"

// A representative policy: floor $5, escalate $30, per-txn $100, daily $200.
const BASE: Omit<DecideInput, "amountUsd"> = {
  category: "software",
  blockedCategories: ["gambling"],
  allowedCategories: [],
  perTxnMaxCents: 10000,
  dailySpentUsd: 0,
  dailyBudgetCents: 20000,
  autoApproveUnderCents: 500,
  escalateOverCents: 3000,
}
const decide = (amountUsd: number, over: Partial<DecideInput> = {}) => decidePolicy({ amountUsd, ...BASE, ...over })

describe("decidePolicy — the spend ladder", () => {
  it("auto-approves at/under the floor", () => {
    expect(decide(3)).toEqual({ status: "approved", note: "Auto-approved (under auto-approve floor)" })
  })

  it("auto-approves between floor and escalation threshold", () => {
    expect(decide(10)).toEqual({ status: "approved", note: "Auto-approved by policy" })
  })

  it("escalates over the escalation threshold", () => {
    expect(decide(50)).toEqual({ status: "escalated", note: "Exceeds escalation threshold" })
  })

  it("FLOOR WINS OVER ESCALATION — under floor never escalates even if over the escalate line", () => {
    // floor $50, escalate $30, amount $40 → under floor → approved, not escalated
    expect(decide(40, { autoApproveUnderCents: 5000, escalateOverCents: 3000 })).toEqual({
      status: "approved",
      note: "Auto-approved (under auto-approve floor)",
    })
  })

  it("denies a blocked category", () => {
    expect(decide(1, { category: "gambling" })).toEqual({ status: "denied", note: "Category 'gambling' is blocked" })
  })

  it("denies a category missing from a non-empty allow-list", () => {
    expect(decide(1, { allowedCategories: ["software"], category: "hardware" })).toEqual({
      status: "denied",
      note: "Category 'hardware' is not in the allow-list",
    })
  })

  it("allows a category present in the allow-list", () => {
    expect(decide(1, { allowedCategories: ["software"], category: "software" }).status).toBe("approved")
  })

  it("denies over the per-transaction limit", () => {
    expect(decide(150)).toEqual({ status: "denied", note: "Exceeds per-transaction limit of $100" })
  })

  it("denies when the daily budget would be exceeded", () => {
    expect(decide(2, { dailySpentUsd: 199 })).toEqual({ status: "denied", note: "Daily spend budget exceeded" })
  })

  it("allows exactly at the daily budget boundary (> is the bar, not >=)", () => {
    // $199 spent + $1 = $200 == budget → not exceeded
    expect(decide(1, { dailySpentUsd: 199 }).status).toBe("approved")
  })
})

describe("decidePolicy — precedence between gates", () => {
  it("blocked category beats the per-transaction limit", () => {
    expect(decide(150, { category: "gambling" }).note).toBe("Category 'gambling' is blocked")
  })

  it("per-transaction limit beats the daily budget", () => {
    expect(decide(150, { dailyBudgetCents: 1 }).note).toContain("per-transaction")
  })

  it("rounds amount to cents at the per-txn boundary", () => {
    expect(decide(19.99, { perTxnMaxCents: 1999 }).status).toBe("approved") // 1999 <= 1999
    expect(decide(20.0, { perTxnMaxCents: 1999 }).status).toBe("denied") // 2000 > 1999
  })
})

describe("decidePolicy → decisionCode (full stack)", () => {
  const code = (amountUsd: number, over: Partial<DecideInput> = {}) => {
    const d = decide(amountUsd, over)
    return decisionCode(d.status, d.note)
  }

  it("maps every ladder outcome to its stable code", () => {
    expect(code(3)).toBeUndefined() // approved
    expect(code(50)).toBe("ESCALATION_REQUIRED")
    expect(code(1, { category: "gambling" })).toBe("CATEGORY_BLOCKED")
    expect(code(1, { allowedCategories: ["software"], category: "hardware" })).toBe("CATEGORY_NOT_ALLOWED")
    expect(code(150)).toBe("PER_TXN_LIMIT")
    expect(code(2, { dailySpentUsd: 199 })).toBe("DAILY_BUDGET_EXCEEDED")
  })
})
