import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { getViewWallet } from "@/lib/session"
import { DashboardNav } from "@/components/dashboard-nav"
import { AccountControl } from "@/components/account-control"
import { AgentCreator } from "@/components/agent-creator"
import { ApiKeysTable, type ConsoleAgent } from "@/components/api-keys-table"

export const metadata: Metadata = { title: "API Keys — Sanction" }

export default async function KeysPage() {
  const view = await getViewWallet()
  if (!view) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-zinc-400 text-sm">No wallet to show.</p>
          <div className="flex items-center justify-center gap-3 text-sm">
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link>
            <Link href="/start" className="text-zinc-400 hover:text-zinc-200">Create a wallet</Link>
          </div>
        </div>
      </div>
    )
  }

  const rows = await db.agent.findMany({
    where: { walletId: view.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
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
  // Per-key activity: what's actually using this key. Top model + total calls
  // (from TokenLog, which the gateway writes per metered call) and the most
  // recent task label, so the row shows "seen claude-… · N calls · task: …".
  const ids = rows.map((a) => a.id)
  const [modelCounts, lastLogs] = ids.length
    ? await Promise.all([
        db.tokenLog.groupBy({
          by: ["agentId", "model"],
          where: { agentId: { in: ids } },
          _count: { _all: true },
        }),
        db.tokenLog.findMany({
          where: { agentId: { in: ids } },
          orderBy: { createdAt: "desc" },
          distinct: ["agentId"],
          select: { agentId: true, taskLabel: true, createdAt: true },
        }),
      ])
    : [[], []]

  type Act = { totalCalls: number; topModel: string | null; topCalls: number; lastTask: string | null; lastSeen: string | null }
  const activity = new Map<string, Act>()
  const get = (id: string): Act =>
    activity.get(id) ?? { totalCalls: 0, topModel: null, topCalls: 0, lastTask: null, lastSeen: null }
  for (const r of modelCounts) {
    const cur = get(r.agentId)
    cur.totalCalls += r._count._all
    if (r._count._all > cur.topCalls) {
      cur.topModel = r.model
      cur.topCalls = r._count._all
    }
    activity.set(r.agentId, cur)
  }
  for (const l of lastLogs) {
    const cur = get(l.agentId)
    cur.lastTask = l.taskLabel
    cur.lastSeen = l.createdAt.toISOString()
    activity.set(l.agentId, cur)
  }

  const agents: ConsoleAgent[] = rows.map((a) => {
    const act = activity.get(a.id)
    return {
      id: a.id,
      name: a.name,
      apiKeyPrefix: a.apiKeyPrefix,
      isActive: a.isActive,
      createdAt: a.createdAt.toISOString(),
      lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
      dailyTokenBudgetUsd: a.dailyTokenBudgetUsd,
      dailySpendBudgetUsd: a.dailySpendBudgetUsd,
      perTransactionMaxUsd: a.perTransactionMaxUsd,
      escalateOverUsd: a.escalateOverUsd,
      clearance: a.clearance?.level ?? null,
      activity: act
        ? { totalCalls: act.totalCalls, topModel: act.topModel, lastTask: act.lastTask, lastSeen: act.lastSeen }
        : null,
    }
  })

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight hover:text-zinc-300 transition-colors">Sanction</Link>
          <p className="text-zinc-500 text-sm">{view.name} · API keys</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DashboardNav active="keys" />
          <AccountControl view={view} />
        </div>
      </div>

      <div>
        <h1 className="font-display text-lg font-semibold tracking-tight">API Keys</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Create, rotate, and revoke the keys your agents authenticate with. Keys are shown once — store them when issued.
        </p>
      </div>

      {view.isSession ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <AgentCreator />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link> to create and manage keys.
        </p>
      )}

      <ApiKeysTable agents={agents} editable={view.isSession} />
    </div>
  )
}
