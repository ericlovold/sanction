// Pure spend-policy decision logic, shared by /authorize and its tests. Kept
// DB-free so the precedence rules can be unit-tested in isolation (mirrors
// lib/decisions.ts). All monetary amounts here are integer cents.

// --- Category gate --------------------------------------------------------

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

// --- Spend tier -----------------------------------------------------------

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
