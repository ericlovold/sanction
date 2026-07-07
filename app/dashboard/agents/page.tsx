import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { getViewWallet } from "@/lib/session"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { ApiKeysTable, type ConsoleAgent } from "@/components/api-keys-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Agents — Sanction",
  description: "Manage agent identities, capability keys, and live authorization posture.",
}

async function walletScopeIds(rootWalletId: string, scope: "wallet" | "subtree"): Promise<string[]> {
  if (scope === "wallet") return [rootWalletId]
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE subtree AS (
      SELECT id, "parentId" FROM "Wallet" WHERE id = ${rootWalletId}
      UNION ALL
      SELECT w.id, w."parentId"
      FROM "Wallet" w JOIN subtree s ON w."parentId" = s.id
    )
    SELECT id FROM subtree
  `
  return rows.map((r) => r.id)
}

async function getAgents(walletId: string, scope: "wallet" | "subtree") {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const walletIds = await walletScopeIds(walletId, scope)
  const wallets = await db.wallet.findMany({ where: { id: { in: walletIds } }, select: { id: true, name: true } })
  const walletById = new Map(wallets.map((w) => [w.id, w.name]))

  const rows = await db.agent.findMany({
    where: { walletId: { in: walletIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      walletId: true,
      name: true,
      holder: true,
      expiresAt: true,
      apiKeyPrefix: true,
      isActive: true,
      createdAt: true,
      lastUsedAt: true,
      dailyTokenBudgetUsd: true,
      dailySpendBudgetUsd: true,
      perTransactionMaxUsd: true,
      escalateOverUsd: true,
      clearance: { select: { level: true } },
    },
  })
  const agentIds = rows.map((a) => a.id)
  const now = new Date()
  const [pending, activeGrants, decisions, modelCounts, lastLogs] = await Promise.all([
    db.pendingApproval.groupBy({
      by: ["agentId"],
      where: { walletId: { in: walletIds }, agentId: { in: agentIds }, status: "pending" },
      _count: true,
    }),
    db.grant.groupBy({
      by: ["agentId"],
      where: {
        walletId: { in: walletIds },
        agentId: { in: agentIds },
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _count: true,
    }),
    db.authorizationRequest.groupBy({
      by: ["agentId", "status"],
      where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } },
      _count: true,
    }),
    db.tokenLog.groupBy({
      by: ["agentId", "model"],
      where: { agentId: { in: agentIds } },
      _count: { _all: true },
    }),
    db.tokenLog.findMany({
      where: { agentId: { in: agentIds } },
      orderBy: { createdAt: "desc" },
      distinct: ["agentId"],
      select: { agentId: true, taskLabel: true, createdAt: true },
    }),
  ])

  const pendingByAgent = new Map(pending.map((r) => [r.agentId, r._count]))
  const grantsByAgent = new Map(activeGrants.map((r) => [r.agentId, r._count]))
  const decisionByAgent = new Map<string, { approved: number; denied: number; escalated: number }>()
  for (const r of decisions) {
    const row = decisionByAgent.get(r.agentId) ?? { approved: 0, denied: 0, escalated: 0 }
    if (r.status === "approved") row.approved = r._count
    if (r.status === "denied") row.denied = r._count
    if (r.status === "escalated") row.escalated = r._count
    decisionByAgent.set(r.agentId, row)
  }

  // Per-key activity: what's actually using this key. Top model + total calls
  // (from TokenLog, which the gateway writes per metered call) and the most
  // recent task label, so the row shows "seen claude-… · N calls · task: …".
  type Act = { totalCalls: number; topModel: string | null; topCalls: number; lastTask: string | null; lastSeen: string | null }
  const activityByAgent = new Map<string, Act>()
  const getAct = (id: string): Act =>
    activityByAgent.get(id) ?? { totalCalls: 0, topModel: null, topCalls: 0, lastTask: null, lastSeen: null }
  for (const r of modelCounts) {
    const cur = getAct(r.agentId)
    cur.totalCalls += r._count._all
    if (r._count._all > cur.topCalls) {
      cur.topModel = r.model
      cur.topCalls = r._count._all
    }
    activityByAgent.set(r.agentId, cur)
  }
  for (const l of lastLogs) {
    const cur = getAct(l.agentId)
    cur.lastTask = l.taskLabel
    cur.lastSeen = l.createdAt.toISOString()
    activityByAgent.set(l.agentId, cur)
  }

  return rows.map((a): ConsoleAgent => {
    const mix = decisionByAgent.get(a.id) ?? { approved: 0, denied: 0, escalated: 0 }
    const act = activityByAgent.get(a.id)
    return {
      id: a.id,
      walletId: a.walletId,
      walletName: walletById.get(a.walletId) ?? "unknown wallet",
      name: a.name,
      holder: a.holder,
      expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
      apiKeyPrefix: a.apiKeyPrefix,
      isActive: a.isActive,
      createdAt: a.createdAt.toISOString(),
      lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
      dailyTokenBudgetUsd: a.dailyTokenBudgetUsd,
      dailySpendBudgetUsd: a.dailySpendBudgetUsd,
      perTransactionMaxUsd: a.perTransactionMaxUsd,
      escalateOverUsd: a.escalateOverUsd,
      clearance: a.clearance?.level ?? null,
      pendingApprovals: pendingByAgent.get(a.id) ?? 0,
      activeGrants: grantsByAgent.get(a.id) ?? 0,
      approvedMonth: mix.approved,
      deniedMonth: mix.denied,
      escalatedMonth: mix.escalated,
      activity: act
        ? { totalCalls: act.totalCalls, topModel: act.topModel, lastTask: act.lastTask, lastSeen: act.lastSeen }
        : null,
    }
  })
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: { scope?: string; state?: string }
}) {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const params = searchParams ?? {}
  const scope: "wallet" | "subtree" = params.scope === "subtree" ? "subtree" : "wallet"
  const stateFilter = params.state === "inactive" || params.state === "expiring" || params.state === "expired" ? params.state : "all"
  const agents = await getAgents(view.id, scope)
  const now = new Date()
  const expiringSoon = agents.filter(
    (a) => a.expiresAt && new Date(a.expiresAt) > now && new Date(a.expiresAt).getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000,
  ).length
  const inactiveAgents = agents.filter((a) => !a.isActive).length
  const expiredAgents = agents.filter((a) => a.expiresAt && new Date(a.expiresAt) <= now).length
  const filteredAgents = agents.filter((a) => {
    if (stateFilter === "inactive") return !a.isActive
    if (stateFilter === "expiring") {
      if (!a.expiresAt) return false
      const t = new Date(a.expiresAt).getTime()
      return t > now.getTime() && t - now.getTime() <= 7 * 24 * 60 * 60 * 1000
    }
    if (stateFilter === "expired") return !!a.expiresAt && new Date(a.expiresAt) <= now
    return true
  })
  const activeAgents = agents.filter((a) => a.isActive).length
  const activeGrants = agents.reduce((sum, a) => sum + a.activeGrants, 0)
  const pendingApprovals = agents.reduce((sum, a) => sum + a.pendingApprovals, 0)

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-100">Seats (Agents)</h1>
      <p className="-mt-4 text-sm text-zinc-500">
        Each seat is an agent identity with its own key, limits, and audit trail. The key is the runtime identity; seat
        holder and expiry are operator controls.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href={`/dashboard/agents?scope=wallet${stateFilter !== "all" ? `&state=${stateFilter}` : ""}`}
          className={`rounded border px-2 py-1 ${scope === "wallet" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
        >
          Current wallet
        </Link>
        <Link
          href={`/dashboard/agents?scope=subtree${stateFilter !== "all" ? `&state=${stateFilter}` : ""}`}
          className={`rounded border px-2 py-1 ${scope === "subtree" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
        >
          Hierarchy (wallet + pools)
        </Link>
        {(["all", "inactive", "expiring", "expired"] as const).map((state) => (
          <Link
            key={state}
            href={`/dashboard/agents?scope=${scope}${state === "all" ? "" : `&state=${state}`}`}
            className={`rounded border px-2 py-1 ${stateFilter === state ? "border-zinc-700 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
          >
            {state}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Active agents</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{activeAgents}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Active grants</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{activeGrants}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Pending approvals</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{pendingApprovals}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Expiring in 7d</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{expiringSoon}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Inactive / expired</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{inactiveAgents + expiredAgents}</p>
            <p className="text-xs text-zinc-600">{inactiveAgents} inactive · {expiredAgents} expired</p>
          </CardContent>
        </Card>
      </div>

      {view.isSession ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <AgentCreator />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link> to create and manage agents.
        </p>
      )}

      <ApiKeysTable agents={filteredAgents} editable={view.isSession} />
    </div>
  )
}
