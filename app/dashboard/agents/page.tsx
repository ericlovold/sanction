import type { Metadata } from "next"
import Link from "next/link"
import { agentState, agentExpiringSoon, waitingApprovalWhere } from "@/lib/dashboardCounts"
import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { readSeatActivity } from "@/lib/seatActivity"
import { getViewWallet } from "@/lib/session"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { ApiKeysTable, type ConsoleAgent } from "@/components/api-keys-table"
import { ExecutionTokensSection } from "@/components/execution-tokens-section"
import { AgentsHeader } from "@/components/agents-header"
import { hasRole } from "@/lib/roles"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Agents — Sanction",
  description: "Every agent on this wallet: its key, limits, holder and recent decisions.",
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

async function getAgents(walletId: string, scope: "wallet" | "subtree", now: Date) {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const walletIds = await walletScopeIds(walletId, scope)
  const wallets = await db.wallet.findMany({ where: { id: { in: walletIds } }, select: { id: true, name: true } })
  const walletById = new Map(wallets.map((w) => [w.id, w.name]))

  // RLS-scoped (SEC-3): the `clearance` select joins AgentClearance (FORCE
  // RLS) — unscoped, a restricted app role reads every clearance as null.
  const rows = await withTenant(walletIds, (tx) =>
    tx.agent.findMany({
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
    }),
  )
  const agentIds = rows.map((a) => a.id)
  const [pending, activeGrants, decisions, activity] = await Promise.all([
    db.pendingApproval.groupBy({
      by: ["agentId"],
      where: { ...waitingApprovalWhere(walletIds, now), agentId: { in: agentIds } },
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
    readSeatActivity(walletIds, agentIds),
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

  const activityByAgent = new Map(activity.map((r) => [r.agentId, r]))

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
        ? { totalCalls: act.totalCalls, topModel: act.topModel, lastTask: act.lastTask, lastSeen: act.lastSeen.toISOString() }
        : null,
    }
  })
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; state?: string }>
}) {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const params = (await searchParams) ?? {}
  // Default to the whole hierarchy — a parent wallet's roster is the org's. A
  // leaf's subtree is itself, so single-wallet operators see no difference.
  // "Current wallet" narrows back to just this wallet's own seats.
  const scope: "wallet" | "subtree" = params.scope === "wallet" ? "wallet" : "subtree"
  const stateFilter = params.state === "inactive" || params.state === "expiring" || params.state === "expired" ? params.state : "all"
  const now = new Date()
  const agents = await getAgents(view.id, scope, now)
  const expiringSoon = agents.filter((a) => agentExpiringSoon(a, now)).length
  const inactiveAgents = agents.filter((a) => agentState(a, now) === "revoked").length
  const expiredAgents = agents.filter((a) => agentState(a, now) === "expired").length
  const filteredAgents = agents.filter((a) => {
    if (stateFilter === "inactive") return agentState(a, now) === "revoked"
    if (stateFilter === "expiring") return agentExpiringSoon(a, now)
    if (stateFilter === "expired") return agentState(a, now) === "expired"
    return true
  })
  const activeAgents = agents.filter((a) => agentState(a, now) === "active").length
  const activeGrants = agents.reduce((sum, a) => sum + a.activeGrants, 0)
  const pendingApprovals = agents.reduce((sum, a) => sum + a.pendingApprovals, 0)

  const canEdit = hasRole(view.role, "admin")
  const off = inactiveAgents + expiredAgents
  // One sentence instead of a row of stat boxes. Zero counts are left out.
  const summary = [
    agents.length === 0
      ? "No agents yet."
      : `${activeAgents} active${off > 0 ? `, ${off} off or expired` : ""}.`,
    pendingApprovals > 0 ? `${pendingApprovals} waiting on you.` : "",
    expiringSoon > 0 ? `${expiringSoon} ${expiringSoon === 1 ? "expires" : "expire"} within 7 days.` : "",
    activeGrants > 0 ? `${activeGrants} active ${activeGrants === 1 ? "grant" : "grants"}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const stateHref = (state: string) => `/dashboard/agents?scope=${scope}${state === "all" ? "" : `&state=${state}`}`
  const scopeHref = (next: string) => `/dashboard/agents?scope=${next}${stateFilter !== "all" ? `&state=${stateFilter}` : ""}`
  const STATES = [
    ["all", "All", agents.length],
    ["inactive", "Off", inactiveAgents],
    ["expiring", "Expiring", expiringSoon],
    ["expired", "Expired", expiredAgents],
  ] as const

  return (
    <div className="home">
      <AgentsHeader summary={summary} startOpen={canEdit && agents.length === 0}>
        {canEdit ? <AgentCreator /> : null}
      </AgentsHeader>

      {!canEdit && (
        <p className="appr-lede">
          {view.isSession ? (
            "Your role can view agents but not add or edit them. Ask the wallet owner for admin access."
          ) : (
            <>
              <Link href="/login" className="home-link">Log in</Link> to add and manage agents.
            </>
          )}
        </p>
      )}

      <section className="home-section" aria-label="Agents">
        <div className="seat-filters">
          <nav className="g-seg" aria-label="Which agents">
            {STATES.map(([state, label, count]) => (
              <Link key={state} href={stateHref(state)} aria-current={stateFilter === state ? "true" : undefined}>
                {label}
                <span className="g-seg-n">{count}</span>
              </Link>
            ))}
          </nav>
          <nav className="g-seg" aria-label="Which groups">
            <Link href={scopeHref("subtree")} aria-current={scope === "subtree" ? "true" : undefined}>All groups</Link>
            <Link href={scopeHref("wallet")} aria-current={scope === "wallet" ? "true" : undefined}>This wallet only</Link>
          </nav>
        </div>
        <ApiKeysTable agents={filteredAgents} editable={canEdit} asOf={now.toISOString()} />
      </section>

      <div className="home-section">
        <ExecutionTokensSection rootWalletId={view.id} editable={canEdit} />
      </div>
    </div>
  )
}
