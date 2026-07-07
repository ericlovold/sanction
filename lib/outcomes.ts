// Outcomes (CPO-1) — the business results a wallet's spend answers to.
//
// Operators report outcomes (enrollments, bookings, signed engagements) from
// their own systems; Sanction never invents them. This module owns the two
// reads the ceiling and the reporting summary share: windowed wallet spend and
// windowed outcome count. Wallet-level on purpose — in the pool model a channel
// IS a wallet, so cost-per-outcome is wallet spend ÷ wallet outcomes.

import { db } from "./db"

export type CpoPolicy = {
  outcomeKind: string | null
  costPerOutcomeCeilingUsd: number | null
  costPerOutcomeWindowDays: number
  costPerOutcomeMinOutcomes: number
}

export type CpoTx = Pick<typeof db, "authorizationRequest" | "outcomeEvent" | "agent">

export function windowStart(days: number, now = new Date()): Date {
  const out = new Date(now)
  out.setDate(out.getDate() - Math.max(1, days))
  return out
}

/** Approved spend across every agent in the wallet since `since`, in dollars. */
export async function walletWindowSpendUsd(tx: CpoTx, walletId: string, since: Date): Promise<number> {
  const agents = await tx.agent.findMany({ where: { walletId }, select: { id: true } })
  if (agents.length === 0) return 0
  const sum = await tx.authorizationRequest.aggregate({
    where: { agentId: { in: agents.map((a) => a.id) }, status: "approved", createdAt: { gte: since } },
    _sum: { amountUsd: true },
  })
  return sum._sum.amountUsd ?? 0
}

/** Outcomes of `kind` recorded for the wallet since `since`. */
export async function walletWindowOutcomes(tx: CpoTx, walletId: string, kind: string, since: Date): Promise<number> {
  return tx.outcomeEvent.count({ where: { walletId, kind, occurredAt: { gte: since } } })
}

/**
 * The ceiling's context read (enforcement shell): undefined when the wallet has
 * no ceiling configured, else the exact numbers the pure rule governs on.
 */
export async function cpoContext(
  tx: CpoTx,
  walletId: string,
  policy: CpoPolicy,
  now = new Date(),
): Promise<{ ceilingCents: number; windowSpendUsd: number; windowOutcomes: number; minOutcomes: number } | undefined> {
  if (policy.costPerOutcomeCeilingUsd == null || !policy.outcomeKind) return undefined
  const since = windowStart(policy.costPerOutcomeWindowDays, now)
  const [windowSpendUsd, windowOutcomes] = await Promise.all([
    walletWindowSpendUsd(tx, walletId, since),
    walletWindowOutcomes(tx, walletId, policy.outcomeKind, since),
  ])
  return {
    ceilingCents: policy.costPerOutcomeCeilingUsd,
    windowSpendUsd,
    windowOutcomes,
    minOutcomes: policy.costPerOutcomeMinOutcomes,
  }
}
