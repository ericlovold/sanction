import { describe, it, expect } from "vitest"
import { decideCredential } from "../lib/credentialDecisions"
import type { CredentialContext } from "../lib/rules/credential"

const BASE: CredentialContext = { clearance: 3, minClearance: 1, revoked: false, expired: false }
const decide = (over: Partial<CredentialContext> = {}) => decideCredential({ ...BASE, ...over })

describe("decideCredential — the vault as a PEP", () => {
  it("permits injection and emits audit_log + no_store obligations", () => {
    const d = decide()
    expect(d.effect).toBe("allow")
    if (d.effect === "allow") {
      expect(d.obligations.map((o) => o.type).sort()).toEqual(["audit_log", "no_store"])
    }
  })

  it("denies a retired credential (410)", () => {
    expect(decide({ revoked: true })).toEqual({ effect: "deny", code: "CRED_REVOKED", reason: "Credential has been retired", status: 410 })
  })

  it("denies an expired credential (410)", () => {
    expect(decide({ expired: true })).toEqual({ effect: "deny", code: "CRED_EXPIRED", reason: "Credential has expired", status: 410 })
  })

  it("denies insufficient clearance (403) with the exact prior message", () => {
    expect(decide({ clearance: 2, minClearance: 4 })).toEqual({
      effect: "deny",
      code: "CRED_INSUFFICIENT_CLEARANCE",
      reason: "Insufficient clearance: credential requires level 4",
      status: 403,
    })
  })

  it("preserves precedence: revoked beats expired beats clearance", () => {
    expect(decide({ revoked: true, expired: true, clearance: 0, minClearance: 5 }).effect).toBe("deny")
    expect((decide({ revoked: true, expired: true }) as { code: string }).code).toBe("CRED_REVOKED")
    expect((decide({ expired: true, clearance: 0, minClearance: 5 }) as { code: string }).code).toBe("CRED_EXPIRED")
  })
})
