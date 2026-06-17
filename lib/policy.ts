// Pure policy logic, shared by the policy endpoint, the /authorize engine, and
// their tests. Kept DB-free so the rules can be unit-tested in isolation
// (mirrors lib/decisions.ts). All monetary amounts here are integer cents.

// --- Policy-shape validation (PATCH /wallets/policy) -----------------------
// Operates on the post-update (merged) policy so a partial patch can never
// leave the policy in a shape the /authorize decision engine can't satisfy.

export type PolicyShape = {
  perTransactionMaxUsd?: number | null
  escalateOverUsd?: number | null
  autoApproveUnderUsd?: number | null
  allowedCategories?: string[] | null
  blockedCategories?: string[] | null
}

// Returns a human-readable error string if the policy is internally inconsistent,
// or null if it is valid. Amounts are integer cents.
export function validatePolicyInvariants(p: PolicyShape): string | null {
  // /authorize denies anything over perTransactionMax BEFORE checking escalation,
  // so escalation is only reachable when escalateOver < perTransactionMax.
  if (p.escalateOverUsd != null && p.perTransactionMaxUsd != null && p.escalateOverUsd >= p.perTransactionMaxUsd) {
    return "escalateOverUsd must be less than perTransactionMaxUsd, otherwise escalation is unreachable (everything above the cap is denied first)"
  }
  if (p.autoApproveUnderUsd != null && p.escalateOverUsd != null && p.autoApproveUnderUsd > p.escalateOverUsd) {
    return "autoApproveUnderUsd must not exceed escalateOverUsd"
  }
  const allowed = p.allowedCategories ?? []
  const blocked = p.blockedCategories ?? []
  const overlap = allowed.filter((c) => blocked.includes(c))
  if (overlap.length > 0) {
    return `Categories cannot be both allowed and blocked: ${overlap.join(", ")}`
  }
  return null
}

// --- Category gate (/authorize) -------------------------------------------

// Precedence the decision engine enforces:
//   1. blocklist wins — a blocked category is always denied.
//   2. allowlist is an allowlist ONLY when non-empty. An empty `allowed` list
//      means allow-all, which preserves the legacy behavior (the AIIA client
//      never sets an allowlist, so it stays fully backward compatible).
export type CategoryVerdict =
  | { allowed: true }
  | { allowed: false; reason: "blocked" | "not_allowed" }

export function evaluateCategory(
  category: string,
  allowedCategories: string[],
  blockedCategories: string[],
): CategoryVerdict {
  if (blockedCategories.includes(category)) return { allowed: false, reason: "blocked" }
  if (allowedCategories.length > 0 && !allowedCategories.includes(category)) {
    return { allowed: false, reason: "not_allowed" }
  }
  return { allowed: true }
}

// --- Spend tier (/authorize) ----------------------------------------------

// Classifies an amount that has already cleared the stateless gates (category,
// per-transaction cap) and the stateful daily-budget check.
//
//   amount < autoApproveUnderUsd                  -> "auto_approve"
//   autoApproveUnderUsd <= amount <= escalateOver -> "auto_approve"
//   amount > escalateOverUsd                      -> "escalate"
//
// `autoApproveUnderUsd` is the documented "definitely safe" floor: anything
// strictly under it auto-approves unconditionally. Amounts between the floor and
// the escalation ceiling still auto-approve — this preserves the pre-existing
// behavior (everything at/under escalateOver was auto-approved) while making the
// floor a meaningful, documented part of the contract rather than dead config.
export type SpendTier = "auto_approve" | "escalate"

export function classifySpend(
  amountCents: number,
  autoApproveUnderUsd: number,
  escalateOverUsd: number,
): SpendTier {
  if (amountCents < autoApproveUnderUsd) return "auto_approve"
  if (amountCents > escalateOverUsd) return "escalate"
  return "auto_approve"
}
