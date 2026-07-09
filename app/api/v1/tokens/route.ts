import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"
import { walletAncestorChain } from "@/lib/cascadeBudget"
import { walletSubtreeIds } from "@/lib/poolAccess"

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

  const policy = agent.wallet.policy
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const logData = { agentId: agent.id, model, tokensIn: tokens_in, tokensOut: tokens_out, costUsd: cost_usd, taskLabel: task }

  // No budget to enforce — log directly.
  if (!policy) {
    const log = await db.tokenLog.create({ data: logData })
    return NextResponse.json({ id: log.id, recorded: true, cost_usd, agent: agent.name })
  }

  // Enforce the SAME token horizons the gateway wall enforces, so an agent
  // logging via /tokens (or MCP sanction_log_tokens) can't outspend a cap that
  // its writes still consume for gateway siblings: seat daily, opt-in seat
  // monthly, and pooled subtree-daily. Per-agent override wins over policy.
  const dailyBudget = (agent.dailyTokenBudgetUsd ?? policy.dailyTokenBudgetUsd) / 100
  const monthlyCents = agent.monthlyTokenBudgetUsd ?? policy.monthlyTokenBudgetUsd
  const monthlyBudget = monthlyCents == null ? null : monthlyCents / 100

  // Ancestors that impose a pooled token cap — resolved outside the lock (their
  // subtree membership doesn't change per request).
  const ancestorChain = await walletAncestorChain(db, agent.walletId)
  const tokenCapAncestors = ancestorChain.filter((n) => n.policy?.subtreeDailyTokenCapUsd != null)

  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`

    const [dailyAgg, monthlyAgg] = await Promise.all([
      tx.tokenLog.aggregate({ where: { agentId: agent.id, createdAt: { gte: dayStart } }, _sum: { costUsd: true } }),
      monthlyBudget == null
        ? Promise.resolve(null)
        : tx.tokenLog.aggregate({ where: { agentId: agent.id, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    ])
    const spent = dailyAgg._sum.costUsd ?? 0
    if (spent + cost_usd > dailyBudget) return { exceeded: "daily" as const, spent, limit: dailyBudget }

    if (monthlyBudget != null) {
      const spentMonth = monthlyAgg?._sum.costUsd ?? 0
      if (spentMonth + cost_usd > monthlyBudget) return { exceeded: "monthly" as const, spent: spentMonth, limit: monthlyBudget }
    }

    for (const node of tokenCapAncestors) {
      const cap = node.policy!.subtreeDailyTokenCapUsd! / 100
      const subtree = await walletSubtreeIds(tx, node.id)
      const agg = await tx.tokenLog.aggregate({
        where: { agent: { walletId: { in: subtree } }, createdAt: { gte: dayStart } },
        _sum: { costUsd: true },
      })
      const subtreeSpent = agg._sum.costUsd ?? 0
      if (subtreeSpent + cost_usd > cap) {
        return { exceeded: "subtree-daily" as const, spent: subtreeSpent, limit: cap, capWalletId: node.id }
      }
    }

    const log = await tx.tokenLog.create({ data: logData })
    return { exceeded: false as const, logId: log.id, spent }
  })

  if (outcome.exceeded) {
    const label =
      outcome.exceeded === "subtree-daily"
        ? "Pool daily token cap exceeded"
        : outcome.exceeded === "monthly"
          ? "Monthly token budget exceeded"
          : "Daily token budget exceeded"
    return NextResponse.json(
      {
        error: label,
        horizon: outcome.exceeded,
        limit_usd: outcome.limit,
        spent_usd: outcome.spent,
        // Back-compat fields for existing integrations (daily wall shape).
        daily_limit_usd: outcome.exceeded === "daily" ? outcome.limit : undefined,
        daily_spent_usd: outcome.exceeded === "daily" ? outcome.spent : undefined,
        cap_wallet_id: outcome.exceeded === "subtree-daily" ? outcome.capWalletId : undefined,
      },
      { status: 402 },
    )
  }

  // Early warning (no surprises): this call crossed the threshold line of the
  // daily token budget — notify the owner before the 402 wall is hit.
  after(() =>
    notifyTokenBudgetThreshold({
      walletId: agent.walletId,
      ownerEmail: agent.wallet.ownerEmail,
      agentName: agent.name,
      prevUsd: outcome.spent,
      nextUsd: outcome.spent + cost_usd,
      budgetUsd: dailyBudget,
    }),
  )

  return NextResponse.json({ id: outcome.logId, recorded: true, cost_usd, agent: agent.name })
}
