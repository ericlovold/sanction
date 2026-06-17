import { describe, it, expect } from "vitest"
import { validatePolicyInvariants } from "../lib/policy"

describe("validatePolicyInvariants (PATCH /wallets/policy)", () => {
  it("accepts a valid coding-agent blueprint shape", () => {
    expect(
      validatePolicyInvariants({
        perTransactionMaxUsd: 2000,
        escalateOverUsd: 500,
        autoApproveUnderUsd: 500,
        allowedCategories: ["software", "research"],
        blockedCategories: ["gambling", "crypto"],
      }),
    ).toBeNull()
  })

  it("rejects escalateOver >= perTransactionMax (escalation unreachable)", () => {
    expect(validatePolicyInvariants({ perTransactionMaxUsd: 1000, escalateOverUsd: 1000 })).toMatch(/escalation is unreachable/)
    expect(validatePolicyInvariants({ perTransactionMaxUsd: 1000, escalateOverUsd: 2000 })).toMatch(/escalation is unreachable/)
  })

  it("rejects autoApproveUnder above escalateOver", () => {
    expect(validatePolicyInvariants({ escalateOverUsd: 500, autoApproveUnderUsd: 600 })).toMatch(/autoApproveUnderUsd/)
  })

  it("rejects a category that is both allowed and blocked", () => {
    expect(
      validatePolicyInvariants({ allowedCategories: ["software", "crypto"], blockedCategories: ["crypto"] }),
    ).toMatch(/both allowed and blocked: crypto/)
  })

  it("ignores absent fields (partial patch)", () => {
    expect(validatePolicyInvariants({ escalateOverUsd: 500 })).toBeNull()
    expect(validatePolicyInvariants({})).toBeNull()
  })

  it("treats null (cleared) fields as absent", () => {
    expect(validatePolicyInvariants({ perTransactionMaxUsd: null, escalateOverUsd: 500 })).toBeNull()
  })
})
