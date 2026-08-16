import { db } from "@/lib/db"
import { subtreeWalletIds } from "@/lib/walletSubtree"

export type AgentStamp = "live" | "paused" | "blocked"

export type RosterAgent = {
  id: string
  name: string
  holder: string | null
  isActive: boolean
  walletId: string
  monthUsd: number
  pending: number
  stamp: AgentStamp
}

export type RosterGroup = {
  id: string
  name: string
  parentId: string | null
  spendCapUsd: number | null
  monthUsd: number
  pending: number
  agents: RosterAgent[]
  children: RosterGroup[]
}

function startOfMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function agentStamp(agent: { isActive: boolean }, pending: number): AgentStamp {
  if (!agent.isActive) return "blocked"
  if (pending > 0) return "paused"
  return "live"
}

export async function getRoster(rootId: string): Promise<{
  root: RosterGroup
  pendingTotal: number
  agentCount: number
}> {
  const monthStart = startOfMonth()
  const { ids: walletIds } = await subtreeWalletIds(rootId)

  const [wallets, agents, policies, pendingRows] = await Promise.all([
    db.wallet.findMany({
      where: { id: { in: walletIds } },
      select: { id: true, name: true, parentId: true },
    }),
    db.agent.findMany({
      where: { walletId: { in: walletIds } },
      select: { id: true, name: true, holder: true, isActive: true, walletId: true },
      orderBy: { createdAt: "asc" },
    }),
    db.policy.findMany({
      where: { walletId: { in: walletIds } },
      select: { walletId: true, monthlySpendBudgetUsd: true },
    }),
    db.pendingApproval.groupBy({
      by: ["agentId"],
      where: { walletId: { in: walletIds }, status: "pending" },
      _count: { _all: true },
    }),
  ])

  const agentIds = agents.map((a) => a.id)
  const [tokenByAgent, spendByAgent] = agentIds.length
    ? await Promise.all([
        db.tokenLog.groupBy({
          by: ["agentId"],
          where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } },
          _sum: { costUsd: true },
        }),
        db.authorizationRequest.groupBy({
          by: ["agentId"],
          where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } },
          _sum: { amountUsd: true },
        }),
      ])
    : [[], []]

  const pendingByAgent = new Map(pendingRows.map((r) => [r.agentId, r._count._all]))
  const monthByAgent = new Map<string, number>()
  for (const g of tokenByAgent) monthByAgent.set(g.agentId, (monthByAgent.get(g.agentId) ?? 0) + (g._sum.costUsd ?? 0))
  for (const g of spendByAgent) monthByAgent.set(g.agentId, (monthByAgent.get(g.agentId) ?? 0) + (g._sum.amountUsd ?? 0))
  const capByWallet = new Map(
    policies.map((p) => [p.walletId, p.monthlySpendBudgetUsd != null ? p.monthlySpendBudgetUsd / 100 : null]),
  )

  const agentsByWallet = new Map<string, RosterAgent[]>()
  for (const a of agents) {
    const pending = pendingByAgent.get(a.id) ?? 0
    const row: RosterAgent = {
      id: a.id,
      name: a.name,
      holder: a.holder,
      isActive: a.isActive,
      walletId: a.walletId,
      monthUsd: monthByAgent.get(a.id) ?? 0,
      pending,
      stamp: agentStamp(a, pending),
    }
    const list = agentsByWallet.get(a.walletId) ?? []
    list.push(row)
    agentsByWallet.set(a.walletId, list)
  }

  const byId = new Map<string, RosterGroup>()
  for (const w of wallets) {
    const groupAgents = agentsByWallet.get(w.id) ?? []
    byId.set(w.id, {
      id: w.id,
      name: w.name,
      parentId: w.parentId,
      spendCapUsd: capByWallet.get(w.id) ?? null,
      monthUsd: groupAgents.reduce((s, a) => s + a.monthUsd, 0),
      pending: groupAgents.reduce((s, a) => s + a.pending, 0),
      agents: groupAgents,
      children: [],
    })
  }

  for (const w of wallets) {
    if (!w.parentId) continue
    const child = byId.get(w.id)
    const parent = byId.get(w.parentId)
    if (child && parent) parent.children.push(child)
  }

  const root = byId.get(rootId)
  if (!root) {
    return {
      root: {
        id: rootId,
        name: "Wallet",
        parentId: null,
        spendCapUsd: null,
        monthUsd: 0,
        pending: 0,
        agents: [],
        children: [],
      },
      pendingTotal: 0,
      agentCount: 0,
    }
  }

  const rollup = (g: RosterGroup): void => {
    for (const c of g.children) rollup(c)
    g.monthUsd += g.children.reduce((s, c) => s + c.monthUsd, 0)
    g.pending += g.children.reduce((s, c) => s + c.pending, 0)
  }
  rollup(root)

  return { root, pendingTotal: root.pending, agentCount: agents.length }
}
