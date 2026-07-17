import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"
import { monthlyPace, dailyPace } from "@/lib/burn"
import { readScope, scopedWalletIds } from "@/lib/apiScope"

export async function GET(req: NextRequest) {
  let walletId = req.nextUrl.searchParams.get("wallet_id")
  let ownerWallet: Awaited<ReturnType<typeof authenticateOwner>>["wallet"] = null

  if (walletId) {
    // Readable by the wallet owner (x-mgmt-key) OR any active agent in the wallet
    // (x-api-key). Both prove membership; neither is satisfiable by knowing the
    // wallet_id alone — closing the unauthenticated-read hole while keeping the
    // MCP sanction_wallet_status tool working.
    const owner = await authenticateOwner(req, walletId)
    ownerWallet = owner.wallet
    if (!owner.wallet) {
      const { agent } = await authenticateAgent(req)
      if (!agent || agent.walletId !== walletId) {
        return NextResponse.json({ error: "Unauthorized: management key or wallet agent key required" }, { status: 401 })
      }
    }
  } else {
    // No wallet_id: an agent key already names its wallet — derive it, so MCP
    // callers don't need SANCTION_WALLET_ID configured. Management keys are
    // per-wallet credentials verified AGAINST a wallet id, so they still pass
    // wallet_id explicitly.
    const { agent } = await authenticateAgent(req)
    if (!agent) {
      return NextResponse.json({ error: "wallet_id required (or authenticate with an agent key to use its wallet)" }, { status: 400 })
    }
    walletId = agent.walletId
  }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Owner-only subtree widening; an agent key stays scoped to its own wallet.
  // The budget/projection stays on the root wallet's own policy (the envelope).
  const scope = ownerWallet ? readScope(req) : "wallet"
  const { walletIds, truncated } = await scopedWalletIds(walletId, scope)
  const agents = await db.agent.findMany({ where: { walletId: { in: walletIds } }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, tokenMonth, spendDay, spendMonth, recentAuth, recentTokens, pending, policy] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 10, include: { agent: { select: { name: true } } } }),
    db.tokenLog.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 10, include: { agent: { select: { name: true } } } }),
    db.pendingApproval.count({ where: { walletId: { in: walletIds }, status: "pending" } }),
    db.policy.findUnique({ where: { walletId }, select: { monthlySpendBudgetUsd: true, dailySpendBudgetUsd: true } }),
  ])

  // Projections (REPORT-1): linear pace against the wallet caps. The guards in
  // lib/burn.ts keep early-day / early-month extrapolation honest (null).
  const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
  const now = new Date()
  const daySpendUsd = spendDay._sum.amountUsd ?? 0
  const monthSpendUsd = spendMonth._sum.amountUsd ?? 0
  const dayCapUsd = policy ? policy.dailySpendBudgetUsd / 100 : null
  const monthCapUsd = policy?.monthlySpendBudgetUsd != null ? policy.monthlySpendBudgetUsd / 100 : null
  const dayPace = dailyPace(daySpendUsd, dayCapUsd, now)
  const monthPace = monthlyPace(monthSpendUsd, monthCapUsd, now)

  return NextResponse.json({
    today: {
      token_cost_usd: tokenDay._sum.costUsd ?? 0,
      tokens_in: tokenDay._sum.tokensIn ?? 0,
      tokens_out: tokenDay._sum.tokensOut ?? 0,
      spend_usd: daySpendUsd,
      spend_budget_usd: dayCapUsd,
      projected_spend_usd: round2(dayPace.onPace),
      will_exhaust: dayPace.willExhaust,
      exhaust_at: dayPace.exhaustAt?.toISOString() ?? null,
    },
    month: {
      token_cost_usd: tokenMonth._sum.costUsd ?? 0,
      spend_usd: monthSpendUsd,
      spend_budget_usd: monthCapUsd,
      projected_spend_usd: round2(monthPace.onPace),
      will_exhaust: monthPace.willExhaust,
      exhaust_at: monthPace.exhaustAt?.toISOString() ?? null,
    },
    pending_approvals: pending,
    recent_auth: recentAuth,
    recent_tokens: recentTokens,
    scope,
    ...(truncated ? { truncated: true } : {}),
  })
}
