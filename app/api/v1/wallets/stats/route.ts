import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  // Readable by the wallet owner (x-mgmt-key) OR any active agent in the wallet
  // (x-api-key). Both prove membership; neither is satisfiable by knowing the
  // wallet_id alone — closing the unauthenticated-read hole while keeping the
  // MCP sanction_wallet_status tool working.
  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    const { agent } = await authenticateAgent(req)
    if (!agent || agent.walletId !== walletId) {
      return NextResponse.json({ error: "Unauthorized: management key or wallet agent key required" }, { status: 401 })
    }
  }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, tokenMonth, spendDay, spendMonth, recentAuth, recentTokens, pending] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 10, include: { agent: { select: { name: true } } } }),
    db.tokenLog.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 10, include: { agent: { select: { name: true } } } }),
    db.authorizationRequest.count({ where: { agentId: { in: agentIds }, status: "escalated" } }),
  ])

  return NextResponse.json({
    today: {
      token_cost_usd: tokenDay._sum.costUsd ?? 0,
      tokens_in: tokenDay._sum.tokensIn ?? 0,
      tokens_out: tokenDay._sum.tokensOut ?? 0,
      spend_usd: spendDay._sum.amountUsd ?? 0,
    },
    month: {
      token_cost_usd: tokenMonth._sum.costUsd ?? 0,
      spend_usd: spendMonth._sum.amountUsd ?? 0,
    },
    pending_approvals: pending,
    recent_auth: recentAuth,
    recent_tokens: recentTokens,
  })
}
