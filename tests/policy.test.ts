import { describe, it, expect } from "vitest"
import { evaluateCategory, classifySpend } from "../lib/policy"

describe("evaluateCategory (allowlist + blocklist gate)", () => {
  it("blocklist always wins, even if also allowed", () => {
    expect(evaluateCategory("crypto", ["crypto", "software"], ["crypto"])).toEqual({
      allowed: false,
      reason: "blocked",
    })
  })

  it("denies a category absent from a non-empty allowlist", () => {
    expect(evaluateCategory("travel", ["software", "research"], [])).toEqual({
      allowed: false,
      reason: "not_allowed",
    })
  })

  it("allows a category present in the allowlist", () => {
    expect(evaluateCategory("software", ["software", "research"], [])).toEqual({ allowed: true })
  })

  it("empty allowlist = allow-all (backward compatible / AIIA client)", () => {
    expect(evaluateCategory("anything", [], [])).toEqual({ allowed: true })
    expect(evaluateCategory("travel", [], ["gambling"])).toEqual({ allowed: true })
  })

  it("blocklist still applies under allow-all", () => {
    expect(evaluateCategory("gambling", [], ["gambling"])).toEqual({ allowed: false, reason: "blocked" })
  })
})

describe("classifySpend (auto-approve vs escalate tiers)", () => {
  // cents: autoApproveUnder = 2500 ($25), escalateOver = 10000 ($100)
  it("auto-approves strictly under the auto-approve floor", () => {
    expect(classifySpend(2499, 2500, 10000)).toBe("auto_approve")
  })

  it("auto-approves between the floor and the escalation ceiling (preserves legacy behavior)", () => {
    expect(classifySpend(2500, 2500, 10000)).toBe("auto_approve")
    expect(classifySpend(9999, 2500, 10000)).toBe("auto_approve")
    expect(classifySpend(10000, 2500, 10000)).toBe("auto_approve")
  })

  it("escalates strictly above the escalation ceiling", () => {
    expect(classifySpend(10001, 2500, 10000)).toBe("escalate")
  })

  it("with floor == ceiling, only amounts above the ceiling escalate", () => {
    expect(classifySpend(5000, 5000, 5000)).toBe("auto_approve")
    expect(classifySpend(5001, 5000, 5000)).toBe("escalate")
    expect(classifySpend(4999, 5000, 5000)).toBe("auto_approve")
  })
})
