import { decisionCode, type DecisionCode } from "@/lib/decisions"

// C2 (OBS-1 follow-through): the monitoring digest over observed decisions.
// Observe-mode pools persist every truthful would-be decision with an
// `observed` marker (see /authorize routes); this module folds those rows into
// the per-pool story the dashboard tells — "here is what enforcement would
// have done" — so flipping a pool to enforce is an evidenced decision, not a
// leap. Pure over its inputs so the aggregation is unit-testable without a DB.

export type ObservedRow = {
  agentId: string
  amountUsd: number
  status: string
  decisionNote: string | null
}

export type ObserveTally = {
  total: number
  wouldAllow: number
  wouldEscalate: number
  wouldDeny: number
  /** Spend that enforcement would have stopped outright (sum of would-be denials). */
  deniedUsd: number
  /** Spend that would have waited on a human (sum of would-be escalations). */
  escalatedUsd: number
}

export type CodeCount = { code: DecisionCode; count: number }

export const emptyTally = (): ObserveTally => ({
  total: 0,
  wouldAllow: 0,
  wouldEscalate: 0,
  wouldDeny: 0,
  deniedUsd: 0,
  escalatedUsd: 0,
})

export type ObserveDigest = {
  perWallet: Map<string, ObserveTally>
  totals: ObserveTally
  /** Decision codes behind the would-be denials/escalations, most frequent first. */
  topCodes: CodeCount[]
}

export function buildObserveDigest(rows: ObservedRow[], agentToWallet: Map<string, string>): ObserveDigest {
  const perWallet = new Map<string, ObserveTally>()
  const totals = emptyTally()
  const codeCounts = new Map<DecisionCode, number>()

  for (const row of rows) {
    const walletId = agentToWallet.get(row.agentId)
    if (!walletId) continue // agent moved/deleted since the row was written — nothing to attribute it to
    let tally = perWallet.get(walletId)
    if (!tally) {
      tally = emptyTally()
      perWallet.set(walletId, tally)
    }
    for (const t of [tally, totals]) {
      t.total += 1
      if (row.status === "approved") t.wouldAllow += 1
      else if (row.status === "escalated") {
        t.wouldEscalate += 1
        t.escalatedUsd += row.amountUsd
      } else if (row.status === "denied") {
        t.wouldDeny += 1
        t.deniedUsd += row.amountUsd
      }
    }
    const code = decisionCode(row.status, row.decisionNote)
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
  }

  const topCodes = [...codeCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))

  return { perWallet, totals, topCodes }
}
