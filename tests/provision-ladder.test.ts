import { describe, expect, it } from "vitest"
import { decideProvisionPolicy, decisionCode, type ProvisionDecideInput } from "../lib/decisions"

// $ values in cents where the name says Cents. Base: floor $10, escalate $25,
// per-txn $50, daily budget $50 — same shape as the spend ladder tests.
function input(overrides: Partial<ProvisionDecideInput> = {}): ProvisionDecideInput {
  return {
    amountUsd: 15,
    category: "infrastructure",
    blockedCategories: [],
    allowedCategories: [],
    perTxnMaxCents: 5000,
    dailySpentUsd: 0,
    dailyBudgetCents: 5000,
    autoApproveUnderCents: 1000,
    escalateOverCents: 2500,
    resource: "azure.seat",
    blockedResources: [],
    allowedResources: [],
    escalateResources: [],
    ...overrides,
  }
}

describe("provision resource gate", () => {
  it("denies a blocked resource before anything else", () => {
    const d = decideProvisionPolicy(input({ blockedResources: ["azure.seat"], amountUsd: 1 }))
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("RESOURCE_BLOCKED")
  })

  it("denies a resource outside a non-empty allow-list", () => {
    const d = decideProvisionPolicy(input({ allowedResources: ["m365.license"] }))
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("RESOURCE_NOT_ALLOWED")
  })

  it("empty allow-list allows any resource (opt-in governance)", () => {
    expect(decideProvisionPolicy(input()).status).toBe("approved")
  })

  it("escalates an escalate-listed resource even under the auto-approve floor", () => {
    const d = decideProvisionPolicy(input({ escalateResources: ["azure.seat"], amountUsd: 1 }))
    expect(d.status).toBe("escalated")
    expect(decisionCode(d.status, d.note)).toBe("ESCALATION_REQUIRED")
  })

  it("block wins over escalate when a resource is on both lists", () => {
    const d = decideProvisionPolicy(input({ blockedResources: ["azure.seat"], escalateResources: ["azure.seat"] }))
    expect(d.status).toBe("denied")
  })
})

describe("provision dollar ladder (shared spend gates)", () => {
  it("auto-approves under the floor", () => {
    const d = decideProvisionPolicy(input({ amountUsd: 9.99 }))
    expect(d.status).toBe("approved")
    expect(d.note).toContain("auto-approve floor")
  })

  it("escalates over the escalation threshold", () => {
    const d = decideProvisionPolicy(input({ amountUsd: 26 }))
    expect(d.status).toBe("escalated")
  })

  it("denies over the per-transaction limit", () => {
    const d = decideProvisionPolicy(input({ amountUsd: 51 }))
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("PER_TXN_LIMIT")
  })

  it("denies when the daily budget would be exceeded", () => {
    const d = decideProvisionPolicy(input({ amountUsd: 20, dailySpentUsd: 35 }))
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("DAILY_BUDGET_EXCEEDED")
  })

  it("category governance applies to provisions too", () => {
    const d = decideProvisionPolicy(input({ blockedCategories: ["infrastructure"] }))
    expect(d.status).toBe("denied")
    expect(decisionCode(d.status, d.note)).toBe("CATEGORY_BLOCKED")
  })
})

describe("decision code disambiguation", () => {
  it("resource allow-list note does not collide with the category code", () => {
    expect(decisionCode("denied", "Resource 'x' is not in the resource allow-list")).toBe("RESOURCE_NOT_ALLOWED")
    expect(decisionCode("denied", "Category 'x' is not in the allow-list")).toBe("CATEGORY_NOT_ALLOWED")
    expect(decisionCode("denied", "Resource 'x' is blocked")).toBe("RESOURCE_BLOCKED")
    expect(decisionCode("denied", "Category 'x' is blocked")).toBe("CATEGORY_BLOCKED")
  })
})
