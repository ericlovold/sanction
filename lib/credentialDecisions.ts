import { evaluate, type Obligation } from "@/lib/evaluation"
import { CREDENTIAL_RULES, type CredentialContext } from "@/lib/rules/credential"

// Decision codes for credential injection (ADR-0009 M4), parallel to spend/tool.
// Each maps to the HTTP status the prior inline gates returned, so the /inject
// response is byte-for-byte unchanged.

export type CredentialDecisionCode = "CRED_REVOKED" | "CRED_EXPIRED" | "CRED_INSUFFICIENT_CLEARANCE"

// The status the prior inline checks returned: retired/expired → 410 Gone,
// insufficient clearance → 403 Forbidden.
const STATUS: Record<CredentialDecisionCode, number> = {
  CRED_REVOKED: 410,
  CRED_EXPIRED: 410,
  CRED_INSUFFICIENT_CLEARANCE: 403,
}

export function credentialStatus(code: string | undefined): number {
  return (code && STATUS[code as CredentialDecisionCode]) || 403
}

export type CredentialDecision =
  | { effect: "allow"; obligations: Obligation[] }
  | { effect: "deny"; code: CredentialDecisionCode; reason: string; status: number }

/** Decide a credential injection through the engine. */
export function decideCredential(ctx: CredentialContext): CredentialDecision {
  const d = evaluate(ctx, CREDENTIAL_RULES)
  if (d.effect === "deny") {
    const code = d.code as CredentialDecisionCode
    return { effect: "deny", code, reason: d.reason ?? "Denied", status: credentialStatus(code) }
  }
  return { effect: "allow", obligations: d.obligations }
}
