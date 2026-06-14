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

  // Check daily token budget
  const policy = agent.wallet.policy
  if (policy) {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const dailySpend = await db.tokenLog.aggregate({
      where: { agentId: agent.id, createdAt: { gte: dayStart } },
      _sum: { costUsd: true },
    })

    const dailyTotal = (dailySpend._sum.costUsd ?? 0) + cost_usd
    const budgetDollars = policy.dailyTokenBudgetUsd / 100

    if (dailyTotal > budgetDollars) {
      return NextResponse.json({
        error: "Daily token budget exceeded",
        daily_limit_usd: budgetDollars,
        daily_spent_usd: dailySpend._sum.costUsd ?? 0,
      }, { status: 402 })
    }
  }

  const log = await db.tokenLog.create({
    data: {
      agentId: agent.id,
      model,
      tokensIn: tokens_in,
      tokensOut: tokens_out,
      costUsd: cost_usd,
      taskLabel: task,
    },
  })

  return NextResponse.json({
    id: log.id,
    recorded: true,
    cost_usd,
    agent: agent.name,
  })
}
