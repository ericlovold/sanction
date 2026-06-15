import { describe, it, expect } from "vitest"
import { POLICY_TEMPLATES, getTemplate, resolvePolicy } from "../lib/policyTemplates"

describe("policy templates", () => {
  it("exposes the documented set", () => {
    expect(POLICY_TEMPLATES.map((t) => t.id)).toEqual(["conservative", "balanced", "growth", "enterprise"])
  })

  it("getTemplate finds a known id and rejects unknown", () => {
    expect(getTemplate("balanced")?.name).toBe("Balanced")
    expect(getTemplate("nope")).toBeUndefined()
  })

  it("every template is internally sane (cents, ordered thresholds)", () => {
    for (const t of POLICY_TEMPLATES) {
      expect(t.autoApproveUnderUsd).toBeLessThanOrEqual(t.escalateOverUsd)
      expect(t.perTransactionMaxUsd).toBeLessThanOrEqual(t.dailySpendBudgetUsd)
      expect(t.allowedCategories.length).toBeGreaterThan(0)
      // allowed and blocked must not overlap
      expect(t.allowedCategories.some((c) => t.blockedCategories.includes(c))).toBe(false)
    }
  })
})

describe("resolvePolicy", () => {
  const balanced = getTemplate("balanced")!

  it("returns template fields when no overrides", () => {
    const r = resolvePolicy(balanced)
    expect(r.dailySpendBudgetUsd).toBe(5000)
    expect(r.escalateOverUsd).toBe(10000)
  })

  it("lets overrides win field-by-field", () => {
    const r = resolvePolicy(balanced, { dailySpendBudgetUsd: 9999, blockedCategories: ["crypto"] })
    expect(r.dailySpendBudgetUsd).toBe(9999)
    expect(r.blockedCategories).toEqual(["crypto"])
    expect(r.perTransactionMaxUsd).toBe(5000) // untouched, from template
  })

  it("returns only the overridden fields when no template", () => {
    const r = resolvePolicy(undefined, { perTransactionMaxUsd: 1234 })
    expect(r).toEqual({ perTransactionMaxUsd: 1234 })
  })
})
