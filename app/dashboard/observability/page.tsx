import type { Metadata } from "next"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { ObservabilityDashboard } from "@/components/observability-dashboard"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { readSpendChartDays } from "@/lib/spendChartDays"
import { decisionsThisMonth } from "@/lib/decisionMeter"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Observability | Sanction",
  description: "Connect agent operations, governed spend, and reported outcomes in one view.",
}

export default async function ObservabilityPage() {
  const wallet = await getViewWallet()
  if (!wallet) return <NoWallet />

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const trendStart = new Date(today)
  trendStart.setUTCDate(trendStart.getUTCDate() - 13)
  const { ids: walletIds } = await subtreeWalletIds(wallet.id)
  const agents = await db.agent.findMany({
    where: { walletId: { in: walletIds } },
    select: { id: true, name: true, isActive: true, lastUsedAt: true },
    orderBy: [{ isActive: "desc" }, { lastUsedAt: "desc" }, { name: "asc" }],
  })
  const agentIds = agents.map(agent => agent.id)

  const [policy, tokenMonth, tokenToday, approvalsByStatus, pending, outcomes, recentDecisions, recentTokens, tokenByAgent, decisionsByAgent, decisionCount, trend] = await Promise.all([
    db.policy.findUnique({ where: { walletId: wallet.id }, select: { dailyTokenBudgetUsd: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart, lte: now } }, _sum: { costUsd: true }, _count: { _all: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: today, lte: now } }, _sum: { costUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: { agentId: { in: agentIds }, createdAt: { gte: monthStart, lte: now } }, _count: { _all: true }, _sum: { amountUsd: true } }),
    db.pendingApproval.count({ where: { walletId: { in: walletIds }, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    db.outcomeEvent.count({ where: { walletId: { in: walletIds }, occurredAt: { gte: monthStart, lte: now } } }),
    db.authorizationRequest.findMany({
      where: { agentId: { in: agentIds }, createdAt: { gte: trendStart, lte: now } },
      orderBy: { createdAt: "desc" }, take: 6,
      select: { id: true, kind: true, action: true, merchant: true, amountUsd: true, status: true, createdAt: true, agent: { select: { name: true } } },
    }),
    db.tokenLog.findMany({
      where: { agentId: { in: agentIds }, createdAt: { gte: trendStart, lte: now } },
      orderBy: { createdAt: "desc" }, take: 6,
      select: { id: true, model: true, costUsd: true, createdAt: true, agent: { select: { name: true } } },
    }),
    db.tokenLog.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: { gte: monthStart, lte: now } }, _sum: { costUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: { gte: monthStart, lte: now } }, _count: { _all: true } }),
    decisionsThisMonth(walletIds, now),
    readSpendChartDays(walletIds, agentIds, today),
  ])

  const approvedSpend = approvalsByStatus.find(row => row.status === "approved")?._sum.amountUsd ?? 0
  const denied = approvalsByStatus.find(row => row.status === "denied")?._count._all ?? 0
  const escalated = approvalsByStatus.find(row => row.status === "escalated")?._count._all ?? 0
  const tokenCostByAgent = new Map(tokenByAgent.map(row => [row.agentId, row._sum.costUsd ?? 0]))
  const decisionsByAgentId = new Map(decisionsByAgent.map(row => [row.agentId, row._count._all]))
  const agentRows = agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    isActive: agent.isActive,
    lastUsedAt: agent.lastUsedAt,
    spend: tokenCostByAgent.get(agent.id) ?? 0,
    decisions: decisionsByAgentId.get(agent.id) ?? 0,
  })).sort((a, b) => b.spend - a.spend).slice(0, 8)

  const activity = [
    ...recentDecisions.map(row => ({
      id: row.id,
      kind: "decision" as const,
      title: `${row.kind === "tool" ? "Tool" : row.kind === "provision" ? "Provision" : "Spend"} · ${row.action || row.merchant}`,
      detail: `${row.agent.name} · ${row.merchant}`,
      status: row.status,
      amount: row.amountUsd,
      createdAt: row.createdAt,
    })),
    ...recentTokens.map(row => ({
      id: row.id,
      kind: "model" as const,
      title: `Model call · ${row.model}`,
      detail: row.agent.name,
      status: "metered",
      amount: row.costUsd,
      createdAt: row.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8)

  return (
    <ObservabilityDashboard
      walletName={wallet.name}
      days={trend.days}
      agents={agentRows}
      activity={activity}
      tokenCost={tokenMonth._sum.costUsd ?? 0}
      approvedSpend={approvedSpend}
      decisions={decisionCount}
      denied={denied}
      escalated={escalated}
      outcomes={outcomes}
      pending={pending}
      activeAgents={agents.filter(agent => agent.isActive).length}
      totalAgents={agents.length}
      todayTokenCost={tokenToday._sum.costUsd ?? 0}
      dailyTokenBudget={(policy?.dailyTokenBudgetUsd ?? 0) / 100}
    />
  )
}
