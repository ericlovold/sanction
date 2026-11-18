import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"
import { GatewayWalletFrozenError, recordTokenUsageUnderBudget } from "@/lib/gatewayBudget"
import { logger } from "@/lib/log"

const noStore = { "cache-control": "no-store" }
const log = logger("v1/tokens")

function unavailableBudgetState() {
  return NextResponse.json(
    { error: "Sanction could not verify token budget state", code: "TOKEN_BUDGET_UNAVAILABLE" },
    { status: 503, headers: noStore },
  )
}

const schema = z.object({
  model: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  task: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401, headers: noStore })

  // KILL-1: a frozen wallet (or ancestor) pauses every data-plane action.
  let freeze
  try {
    freeze = await walletFreezeState(db, agent.walletId)
  } catch {
    log.error("Token budget freeze state unavailable", { agentId: agent.id, walletId: agent.walletId })
    return unavailableBudgetState()
  }
  if (freeze.frozen) {
    if (freeze.unverified) return unavailableBudgetState()
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403, headers: noStore })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400, headers: noStore })
  }

  const { model, tokens_in, tokens_out, cost_usd, task } = parsed.data

  // Logs and in-flight gateway calls consume the same budget capacity, even
  // when this wallet has no local policy but inherits a capped ancestor.
  let outcome: Awaited<ReturnType<typeof recordTokenUsageUnderBudget>>
  try {
    outcome = await recordTokenUsageUnderBudget(agent, {
      model, tokensIn: tokens_in, tokensOut: tokens_out, costUsd: cost_usd, taskLabel: task,
    })
  } catch (error) {
    if (error instanceof GatewayWalletFrozenError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403, headers: noStore })
    }
    log.error("Token budget state unavailable", { agentId: agent.id, walletId: agent.walletId })
    return unavailableBudgetState()
  }

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
      { status: 402, headers: noStore },
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

  return NextResponse.json({ id: outcome.logId, recorded: true, cost_usd, agent: agent.name }, { headers: noStore })
}
