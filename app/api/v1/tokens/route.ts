import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"

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

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { model, tokens_in, tokens_out, cost_usd, task } = parsed.data

  const policy = agent.wallet.policy
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const logData = { agentId: agent.id, model, tokensIn: tokens_in, tokensOut: tokens_out, costUsd: cost_usd, taskLabel: task }

  // No budget to enforce — log directly.
  if (!policy) {
    const log = await db.tokenLog.create({ data: logData })
    return NextResponse.json({ id: log.id, recorded: true, cost_usd, agent: agent.name })
  }

  // Atomic budget check + write: serialize per agent so concurrent calls can't
  // both pass the check and overshoot the daily token budget.
  // Per-agent override wins over the wallet policy.
  const budgetDollars = (agent.dailyTokenBudgetUsd ?? policy.dailyTokenBudgetUsd) / 100
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`

    const dailySpend = await tx.tokenLog.aggregate({
      where: { agentId: agent.id, createdAt: { gte: dayStart } },
      _sum: { costUsd: true },
    })
    const spent = dailySpend._sum.costUsd ?? 0
    if (spent + cost_usd > budgetDollars) {
      return { exceeded: true as const, spent }
    }
    const log = await tx.tokenLog.create({ data: logData })
    return { exceeded: false as const, logId: log.id }
  })

  if (outcome.exceeded) {
    return NextResponse.json({
      error: "Daily token budget exceeded",
      daily_limit_usd: budgetDollars,
      daily_spent_usd: outcome.spent,
    }, { status: 402 })
  }

  return NextResponse.json({ id: outcome.logId, recorded: true, cost_usd, agent: agent.name })
}
