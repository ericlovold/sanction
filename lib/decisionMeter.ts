// MONO-0 (docs/plans/monetization-and-distribution.md): per-wallet, per-month
// decision counter — the decision is the future billable unit, counted now so
// pricing could ever launch as a config change, not a rebuild. Rules:
//   - increment once per FRESH decision the engine renders (spend, tool,
//     capability, provision) — approve, escalate, and deny all count alike;
//   - never for idempotent replays, grant redemptions, simulate runs, or
//     frozen-wallet short-circuits (no engine ran);
//   - metering must never fail or slow the decision path: callers invoke it
//     via after(), and errors are logged, not thrown. This is instrumentation,
//     not enforcement state — nothing on the decision path reads it.
import { db } from "@/lib/db"
import { logger } from "@/lib/log"

const log = logger("decisionMeter")

/** UTC "YYYY-MM" — the counter's month key. */
export function monthUtc(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function recordDecision(walletId: string, now: Date = new Date()): Promise<void> {
  const month = monthUtc(now)
  try {
    await db.walletDecisionCounter.upsert({
      where: { walletId_month: { walletId, month } },
      create: { walletId, month, count: 1 },
      update: { count: { increment: 1 } },
    })
  } catch (err) {
    log.warn("decision meter increment failed", { walletId, month, err: String(err) })
  }
}

/** Sum of this month's decisions across the given wallets (a subtree scope). */
export async function decisionsThisMonth(walletIds: string[], now: Date = new Date()): Promise<number> {
  const agg = await db.walletDecisionCounter.aggregate({
    where: { walletId: { in: walletIds }, month: monthUtc(now) },
    _sum: { count: true },
  })
  return agg._sum.count ?? 0
}
