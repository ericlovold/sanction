// Credential-use rules (ADR-0009 M4) — completes the action triad
// (spend → tools → credentials). The vault stops being "secure storage" and
// becomes an enforceable PEP: the credential's own access policy runs through
// the same decision engine.
//
// Scope: this governs the CREDENTIAL's access policy (revoked / expired /
// clearance). Token-layer auth (JWT validity, audience, execution-token status,
// scope) stays as guards at the token boundary in the /inject route, which
// preserves the existing error precedence exactly. Pure over context.

import { allow, type Rule, type Obligation } from "@/lib/evaluation"

export type CredentialContext = {
  clearance: number
  minClearance: number
  revoked: boolean
  expired: boolean
}

// On a permitted injection: audit the access (raw value never logged) and mark
// the decrypted secret non-cacheable.
const INJECT_OBLIGATIONS: Obligation[] = [
  { type: "audit_log", enforcement: "required", event: "credential.inject" },
  { type: "no_store", enforcement: "required" },
]

// Order matches the prior inline gates exactly: revoked → expired → clearance.
export const credentialRevokedRule: Rule<CredentialContext> = {
  id: "credential_revoked",
  run(c) {
    if (c.revoked) return { effect: "deny", ruleId: "credential_revoked", code: "CRED_REVOKED", reason: "Credential has been retired" }
    return allow("credential_revoked")
  },
}

export const credentialExpiredRule: Rule<CredentialContext> = {
  id: "credential_expired",
  run(c) {
    if (c.expired) return { effect: "deny", ruleId: "credential_expired", code: "CRED_EXPIRED", reason: "Credential has expired" }
    return allow("credential_expired")
  },
}

export const credentialClearanceRule: Rule<CredentialContext> = {
  id: "credential_clearance",
  run(c) {
    if (c.clearance < c.minClearance) {
      return { effect: "deny", ruleId: "credential_clearance", code: "CRED_INSUFFICIENT_CLEARANCE", reason: `Insufficient clearance: credential requires level ${c.minClearance}` }
    }
    // Terminal allow carries the inject obligations.
    return allow("credential_clearance", undefined, INJECT_OBLIGATIONS)
  },
}

export const CREDENTIAL_RULES: Rule<CredentialContext>[] = [credentialRevokedRule, credentialExpiredRule, credentialClearanceRule]
