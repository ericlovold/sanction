// The "no surprises" delivery layer: when a charge crosses the 80% line of a
// daily budget (agent spend, agent tokens, or a pool's subtree cap), tell the
// owner BEFORE the limit hits — budget.threshold webhook + heads-up email.
// Best-effort by design: callers fire these from after(), never in-path.

import { db } from "@/lib/db"
import { deliverEvent } from "@/lib/webhooks"
import { sendBudgetThresholdEmail } from "@/lib/email"
import { ALERT_THRESHOLD_PCT, crossedThreshold } from "@/lib/burn"
import { logger } from "@/lib/log"

const log = logger("thresholds")

type Common = { walletId: string; ownerEmail: string; agentName: string }

/** Agent daily spend budget (authorized dollars). Amounts in cents. */
export async function notifySpendBudgetThreshold(
  args: Common & { prevCents: number; nextCents: number; capCents: number | null },
): Promise<void> {
  if (!crossedThreshold(args.prevCents, args.nextCents, args.capCents)) return
  await deliver(args.walletId, args.ownerEmail, {
    scope: "daily_spend",
    label: `${args.agentName} · daily spend budget`,
    agent: args.agentName,
    spentUsd: args.nextCents / 100,
    capUsd: (args.capCents as number) / 100,
  })
}

/** Agent daily token budget (metered LLM cost). Amounts in dollars. */
export async function notifyTokenBudgetThreshold(
  args: Common & { prevUsd: number; nextUsd: number; budgetUsd: number | null },
): Promise<void> {
  if (!crossedThreshold(args.prevUsd, args.nextUsd, args.budgetUsd)) return
  await deliver(args.walletId, args.ownerEmail, {
    scope: "daily_tokens",
    label: `${args.agentName} · daily token budget`,
    agent: args.agentName,
    spentUsd: args.nextUsd,
    capUsd: args.budgetUsd as number,
  })
}

export type CascadeCrossing = { walletId: string; capCents: number; spentCents: number }

/** Pool (subtree daily cap) crossings reported by reserveCascadeDailySpend. */
export async function notifyPoolCapThresholds(
  ownerWalletId: string,
  ownerEmail: string,
  crossings: CascadeCrossing[],
): Promise<void> {
  for (const c of crossings) {
    const pool = await db.wallet.findUnique({ where: { id: c.walletId }, select: { name: true } })
    await deliver(ownerWalletId, ownerEmail, {
      scope: "subtree_daily_spend",
      label: `${pool?.name ?? c.walletId} · pool daily cap`,
      pool: pool?.name ?? c.walletId,
      pool_wallet_id: c.walletId,
      spentUsd: c.spentCents / 100,
      capUsd: c.capCents / 100,
    })
  }
}

async function deliver(
  walletId: string,
  ownerEmail: string,
  detail: { scope: string; label: string; spentUsd: number; capUsd: number; agent?: string; pool?: string; pool_wallet_id?: string },
): Promise<void> {
  const pctUsed = Math.round((detail.spentUsd / detail.capUsd) * 100)
  try {
    await Promise.all([
      deliverEvent(walletId, "budget.threshold", {
        scope: detail.scope,
        threshold_pct: ALERT_THRESHOLD_PCT,
        pct_used: pctUsed,
        spent_usd: detail.spentUsd,
        cap_usd: detail.capUsd,
        agent: detail.agent,
        pool: detail.pool,
        pool_wallet_id: detail.pool_wallet_id,
      }),
      sendBudgetThresholdEmail(ownerEmail, {
        label: detail.label,
        pctUsed,
        spentUsd: detail.spentUsd,
        capUsd: detail.capUsd,
      }),
    ])
  } catch (err) {
    log.warn("threshold notification failed", { scope: detail.scope, err: String(err) })
  }
}
