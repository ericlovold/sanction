import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"
import { dayRangeUtc } from "@/lib/reporting"

// "The one screen you check before coffee" — a single UTC-day rollup of spend,
// decision counts, token cost, secret access, and the most expensive tasks.
// Auth: wallet owner (x-mgmt-key) or any active agent in the wallet (x-api-key).
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    const { agent } = await authenticateAgent(req)
    if (!agent || agent.walletId !== walletId) {
      return NextResponse.json({ error: "Unauthorized: management key or wallet agent key required" }, { status: 401 })
    }
  }

  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  let start: Date, end: Date
  try {
    ({ start, end } = dayRangeUtc(date))
  } catch {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
  }

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)
  const inDay = { gte: start, lt: end }

  const [approved, decisions, tokenAgg, injections, costliestTasks] = await Promise.all([
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: inDay }, _sum: { amountUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: { agentId: { in: agentIds }, createdAt: inDay }, _count: { _all: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: inDay }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.credentialInjection.count({ where: { executionToken: { walletId }, injectedAt: inDay } }),
    db.tokenLog.groupBy({ by: ["taskLabel"], where: { agentId: { in: agentIds }, createdAt: inDay }, _sum: { costUsd: true }, orderBy: { _sum: { costUsd: "desc" } }, take: 5 }),
  ])

  const decisionCounts: Record<string, number> = { approved: 0, denied: 0, escalated: 0, pending: 0 }
  for (const d of decisions) decisionCounts[d.status] = d._count._all

  return NextResponse.json(
    {
      wallet_id: walletId,
      date,
      spend_usd: approved._sum.amountUsd ?? 0,
      decisions: decisionCounts,
      token_cost_usd: tokenAgg._sum.costUsd ?? 0,
      tokens_in: tokenAgg._sum.tokensIn ?? 0,
      tokens_out: tokenAgg._sum.tokensOut ?? 0,
      secret_accesses: injections,
      most_expensive_tasks: costliestTasks.map((t) => ({ task_label: t.taskLabel ?? "(untagged)", cost_usd: t._sum.costUsd ?? 0 })),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
