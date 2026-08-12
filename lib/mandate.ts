/**
 * Mandate evaluation — the public half of an execution JWT.
 *
 * An execution token is already a bounded mandate (scope, budget, TTL, freeze).
 * Counterparties cannot verify HS256 locally; they POST the token here.
 * This module is the pure fold over a loaded row so the HTTP shell stays thin.
 */

export type MandateStatus = "active" | "expired" | "revoked" | "frozen" | "invalid"

export type MandateView = {
  valid: boolean
  status: MandateStatus
  wallet_id?: string
  agent_id?: string
  clearance?: number
  budget_usd?: number
  spent_usd?: number
  remaining_usd?: number
  scope?: string[]
  expires_at?: string
  issued_at?: string
  reason?: string
}

export type MandateTokenRow = {
  id: string
  walletId: string
  agentId: string
  status: string
  revokedAt: Date | null
  expiresAt: Date
  issuedAt: Date
  spentUsd: number
  budgetUsd: number
  scope: string[]
  clearance: number
}

export const MANDATE_INVALID: MandateView = {
  valid: false,
  status: "invalid",
  reason: "Unknown or unverifiable mandate",
}

/** Fold a loaded execution-token row (or its absence) into a public mandate view. */
export function evaluateMandate(args: {
  token: MandateTokenRow | null
  freezeFrozen: boolean
  now?: Date
}): MandateView {
  const token = args.token
  if (!token) return MANDATE_INVALID

  const now = args.now ?? new Date()

  if (token.revokedAt || token.status === "revoked") {
    return {
      valid: false,
      status: "revoked",
      wallet_id: token.walletId,
      agent_id: token.agentId,
      reason: "Mandate revoked",
    }
  }

  if (token.expiresAt <= now || token.status === "expired") {
    return {
      valid: false,
      status: "expired",
      wallet_id: token.walletId,
      agent_id: token.agentId,
      expires_at: token.expiresAt.toISOString(),
      reason: "Mandate expired",
    }
  }

  if (args.freezeFrozen) {
    return {
      valid: false,
      status: "frozen",
      wallet_id: token.walletId,
      agent_id: token.agentId,
      reason: "Wallet is frozen",
    }
  }

  const remaining = Math.max(0, token.budgetUsd - token.spentUsd)
  return {
    valid: true,
    status: "active",
    wallet_id: token.walletId,
    agent_id: token.agentId,
    clearance: token.clearance,
    budget_usd: token.budgetUsd,
    spent_usd: token.spentUsd,
    remaining_usd: remaining,
    scope: token.scope,
    expires_at: token.expiresAt.toISOString(),
    issued_at: token.issuedAt.toISOString(),
  }
}

/** A verified JWT only counts if the row it names still belongs to the same wallet and agent. */
export function bindMandateRow(
  token: MandateTokenRow | null,
  claims: { jti: string; wallet: string; agent: string },
): MandateTokenRow | null {
  if (!token) return null
  if (token.id !== claims.jti) return null
  if (token.walletId !== claims.wallet) return null
  if (token.agentId !== claims.agent) return null
  return token
}
