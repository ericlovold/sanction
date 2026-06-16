import { describe, it, expect } from "vitest"
import { POLICY_TEMPLATES, getTemplate, resolvePolicy, policyCoherenceError } from "../lib/policyTemplates"

describe("policy templates", () => {
  it("exposes the documented set", () => {
    expect(POLICY_TEMPLATES.map((t) => t.id)).toEqual(["conservative", "balanced", "growth", "enterprise"])
  })

  it("getTemplate finds a known id and rejects unknown", () => {
    expect(getTemplate("balanced")?.name).toBe("Balanced")
    expect(getTemplate("nope")).toBeUndefined()
  })

  it("every template satisfies the three-band ordering and is coherent", () => {
    for (const t of POLICY_TEMPLATES) {
      // autoApprove ≤ escalateOver ≤ perTransactionMax ≤ dailySpend
      expect(t.autoApproveUnderUsd).toBeLessThanOrEqual(t.escalateOverUsd)
      expect(t.escalateOverUsd).toBeLessThanOrEqual(t.perTransactionMaxUsd)
      expect(t.perTransactionMaxUsd).toBeLessThanOrEqual(t.dailySpendBudgetUsd)
      expect(policyCoherenceError(t)).toBeNull()
      expect(t.allowedCategories.length).toBeGreaterThan(0)
      // allowed and blocked must not overlap
      expect(t.allowedCategories.some((c) => t.blockedCategories.includes(c))).toBe(false)
    }
  })
})

describe("policyCoherenceError", () => {
  it("rejects an out-of-order threshold set", () => {
    expect(policyCoherenceError({ autoApproveUnderUsd: 5000, escalateOverUsd: 1000, perTransactionMaxUsd: 10000, dailySpendBudgetUsd: 20000 }))
      .toMatch(/auto_approve_under_usd/)
    expect(policyCoherenceError({ autoApproveUnderUsd: 100, escalateOverUsd: 9000, perTransactionMaxUsd: 5000, dailySpendBudgetUsd: 20000 }))
      .toMatch(/escalate_over_usd/)
  })
  it("accepts a coherent set", () => {
    expect(policyCoherenceError({ autoApproveUnderUsd: 2500, escalateOverUsd: 7500, perTransactionMaxUsd: 10000, dailySpendBudgetUsd: 20000 })).toBeNull()
  })
})

describe("resolvePolicy", () => {
  const balanced = getTemplate("balanced")!

  it("returns template fields when no overrides", () => {
    const r = resolvePolicy(balanced)
    expect(r.dailySpendBudgetUsd).toBe(20000)
    expect(r.escalateOverUsd).toBe(7500)
  })

  it("lets overrides win field-by-field", () => {
    const r = resolvePolicy(balanced, { dailySpendBudgetUsd: 99999, blockedCategories: ["crypto"] })
    expect(r.dailySpendBudgetUsd).toBe(99999)
    expect(r.blockedCategories).toEqual(["crypto"])
    expect(r.perTransactionMaxUsd).toBe(10000) // untouched, from template
  })

  it("returns only the overridden fields when no template", () => {
    const r = resolvePolicy(undefined, { perTransactionMaxUsd: 1234 })
    expect(r).toEqual({ perTransactionMaxUsd: 1234 })
  })
})
