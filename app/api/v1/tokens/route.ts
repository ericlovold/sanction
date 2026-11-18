import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"
import { recordTokenUsageUnderBudget } from "@/lib/gatewayBudget"

const schema = z.object({
  model: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  task: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401 })

  // KILL-1: a frozen wallet (or ancestor) pauses every data-plane action.
  const freeze = await walletFreezeState(db, agent.walletId)
  if (freeze.frozen) {
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { model, tokens_in, tokens_out, cost_usd, task } = parsed.data

  // Logs and in-flight gateway calls consume the same budget capacity, even
  // when this wallet has no local policy but inherits a capped ancestor.
  const outcome = await recordTokenUsageUnderBudget(agent, {
    model, tokensIn: tokens_in, tokensOut: tokens_out, costUsd: cost_usd, taskLabel: task,
  })

  if (outcome.exhausted) {
    const label =
      outcome.horizon === "subtree-daily"
        ? "Pool daily token cap exceeded"
        : outcome.horizon === "monthly"
          ? "Monthly token budget exceeded"
          : "Daily token budget exceeded"
    return NextResponse.json(
      {
        error: label,
        horizon: outcome.horizon,
        limit_usd: outcome.budget,
        spent_usd: outcome.spent,
        // Back-compat fields for existing integrations (daily wall shape).
        daily_limit_usd: outcome.horizon === "daily" ? outcome.budget : undefined,
        daily_spent_usd: outcome.horizon === "daily" ? outcome.spent : undefined,
        cap_wallet_id: outcome.capWalletId,
      },
      { status: 402 },
    )
  }

  // Early warning (no surprises): this call crossed the threshold line of the
  // daily token budget — notify the owner before the 402 wall is hit.
  after(() =>
    notifyTokenBudgetThreshold({
      walletId: agent.walletId,
      agentId: agent.id,
      ownerEmail: agent.wallet.ownerEmail,
      agentName: agent.name,
      prevUsd: outcome.spent,
      nextUsd: outcome.spent + cost_usd,
      budgetUsd: outcome.budget,
    }),
  )

  return NextResponse.json({ id: outcome.logId, recorded: true, cost_usd, agent: agent.name })
}
