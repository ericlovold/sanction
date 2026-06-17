// Pure policy-shape validation, shared by the PATCH /wallets/policy endpoint and
// its tests. Operates on the post-update (merged) policy so a partial patch can
// never leave the policy in a shape the /authorize decision engine can't satisfy.

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
