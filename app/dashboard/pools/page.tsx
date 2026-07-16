import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle, GitBranch, Route, ShieldCheck, WalletCards } from "lucide-react"
import { db } from "@/lib/db"
import { allocationMoves, grantAuthorityUsd, poolStatus, spendCapPressure, type PoolStatus } from "@/lib/budgetPools"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { PoolControls } from "@/components/pool-controls"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { dailyPace } from "@/lib/burn"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Pools",
  description: "Budget pools, delegated authority, and allocation strategy for autonomous work.",
}


type WalletNode = {
  id: string
  name: string
  parentId: string | null
  policy: {
    dailySpendBudgetUsd: number
    dailyTokenBudgetUsd: number
    subtreeDailyCapUsd: number | null
  } | null
}

type PoolBucket = {
  agentCount: number
  activeAgentCount: number
  delegatedDailyUsd: number
  delegatedTokenDailyUsd: number
  spendTodayUsd: number
  tokenTodayUsd: number
  spendMonthUsd: number
  activeGrantCount: number
  activeGrantUsd: number
  pendingApprovals: number
  deniedMonth: number
  escalatedMonth: number
}

type PoolRow = WalletNode & PoolBucket & {
  depth: number
  ownCapUsd: number | null
  inheritedCapUsd: number | null
  capUsd: number | null
  capSource: "custom" | "inherited" | "uncapped"
  childCount: number
  status: PoolStatus
}

const emptyBucket = (): PoolBucket => ({
  agentCount: 0,
  activeAgentCount: 0,
  delegatedDailyUsd: 0,
  delegatedTokenDailyUsd: 0,
  spendTodayUsd: 0,
  tokenTodayUsd: 0,
  spendMonthUsd: 0,
  activeGrantCount: 0,
  activeGrantUsd: 0,
  pendingApprovals: 0,
  deniedMonth: 0,
  escalatedMonth: 0,
})

const statusMeta: Record<PoolStatus, { label: string; badge: string; bar: string; text: string }> = {
  cap_missing: {
    label: "uncapped",
    badge: "border-amber-500/20 bg-amber-500/15 text-amber-400",
    bar: "bg-amber-500",
    text: "text-amber-300",
  },
  over_cap: {
    label: "over cap",
    badge: "border-red-500/20 bg-red-500/15 text-red-400",
    bar: "bg-red-500",
    text: "text-red-300",
  },
  hot: {
    label: "hot",
    badge: "border-amber-500/20 bg-amber-500/15 text-amber-400",
    bar: "bg-amber-500",
    text: "text-amber-300",
  },
  warm: {
    label: "warm",
    badge: "border-border bg-muted text-muted-foreground",
    bar: "bg-muted",
    text: "text-muted-foreground",
  },
  clear: {
    label: "clear",
    badge: "border-emerald-500/20 bg-emerald-500/15 text-emerald-400",
    bar: "bg-emerald-500",
    text: "text-primary",
  },
}

const moveToneClass = {
  emerald: "border-emerald-500/20 bg-emerald-500/[0.04]",
  amber: "border-amber-500/20 bg-amber-500/[0.04]",
  red: "border-red-500/20 bg-red-500/[0.04]",
  zinc: "border-border bg-card/40",
}

function dollars(n: number) {
  return `$${n.toFixed(n < 1 && n > 0 ? 4 : 2)}`
}

function capLabel(capUsd: number | null) {
  return capUsd === null ? "Unset" : `${dollars(capUsd)} / day`
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function addBucket(a: PoolBucket, b: PoolBucket): PoolBucket {
  return {
    agentCount: a.agentCount + b.agentCount,
    activeAgentCount: a.activeAgentCount + b.activeAgentCount,
    delegatedDailyUsd: a.delegatedDailyUsd + b.delegatedDailyUsd,
    delegatedTokenDailyUsd: a.delegatedTokenDailyUsd + b.delegatedTokenDailyUsd,
    spendTodayUsd: a.spendTodayUsd + b.spendTodayUsd,
    tokenTodayUsd: a.tokenTodayUsd + b.tokenTodayUsd,
    spendMonthUsd: a.spendMonthUsd + b.spendMonthUsd,
    activeGrantCount: a.activeGrantCount + b.activeGrantCount,
    activeGrantUsd: a.activeGrantUsd + b.activeGrantUsd,
    pendingApprovals: a.pendingApprovals + b.pendingApprovals,
    deniedMonth: a.deniedMonth + b.deniedMonth,
    escalatedMonth: a.escalatedMonth + b.escalatedMonth,
  }
}

function depthOf(wallet: WalletNode, byId: Map<string, WalletNode>) {
  let depth = 0
  let parentId = wallet.parentId
  const seen = new Set<string>([wallet.id])
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    seen.add(parentId)
    depth += 1
    parentId = parent.parentId
  }
  return depth
}

function capChain(wallet: WalletNode, byId: Map<string, WalletNode>) {
  const caps: Array<{ walletId: string; capUsd: number }> = []
  let cur: WalletNode | undefined = wallet
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.policy?.subtreeDailyCapUsd != null) {
      caps.push({ walletId: cur.id, capUsd: cur.policy.subtreeDailyCapUsd / 100 })
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return caps
}

function subtreeIds(rootId: string, childrenOf: Map<string, string[]>, seen = new Set<string>()): string[] {
  if (seen.has(rootId)) return []
  seen.add(rootId)
  const ids = [rootId]
  for (const childId of childrenOf.get(rootId) ?? []) ids.push(...subtreeIds(childId, childrenOf, seen))
  return ids
}

async function loadWalletSubtree(rootId: string): Promise<{ wallets: WalletNode[]; truncated: boolean }> {
  // Shared bounded CTE (lib/walletSubtree) for the ids, then one findMany for
  // the rows — the same subtree scope the approvals and audit pages read.
  const { ids, truncated } = await subtreeWalletIds(rootId)
  if (ids.length === 0) return { wallets: [], truncated: false }

  const nodes = await db.wallet.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      parentId: true,
      policy: { select: { dailySpendBudgetUsd: true, dailyTokenBudgetUsd: true, subtreeDailyCapUsd: true } },
    },
  })
  // Root first — downstream rendering treats wallets[0] as the tree root.
  const wallets = [...nodes.filter((w) => w.id === rootId), ...nodes.filter((w) => w.id !== rootId)]
  return { wallets, truncated }
}

async function getPools(walletId: string) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const now = new Date()

  const { wallets, truncated } = await loadWalletSubtree(walletId)
  const walletIds = wallets.map((wallet) => wallet.id)
  const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]))
  const childrenOf = new Map<string, string[]>()
  for (const wallet of wallets) {
    if (!wallet.parentId) continue
    const children = childrenOf.get(wallet.parentId) ?? []
    children.push(wallet.id)
    childrenOf.set(wallet.parentId, children)
  }

  const agents = await db.agent.findMany({
    where: { walletId: { in: walletIds } },
    select: {
      id: true,
      name: true,
      walletId: true,
      isActive: true,
      dailySpendBudgetUsd: true,
      dailyTokenBudgetUsd: true,
    },
  })
  const agentIds = agents.map((agent) => agent.id)
  const agentToWallet = new Map(agents.map((agent) => [agent.id, agent.walletId]))
  const ownBuckets = new Map(walletIds.map((id) => [id, emptyBucket()]))

  for (const agent of agents) {
    const bucket = ownBuckets.get(agent.walletId)
    const wallet = walletById.get(agent.walletId)
    if (!bucket || !wallet) continue
    bucket.agentCount += 1
    if (agent.isActive) {
      bucket.activeAgentCount += 1
      bucket.delegatedDailyUsd += (agent.dailySpendBudgetUsd ?? wallet.policy?.dailySpendBudgetUsd ?? 0) / 100
      bucket.delegatedTokenDailyUsd += (agent.dailyTokenBudgetUsd ?? wallet.policy?.dailyTokenBudgetUsd ?? 0) / 100
    }
  }

  const [tokToday, spendToday, spendMonth, activeGrants, pendingApprovals, decisions, modelCosts] = await Promise.all([
    db.tokenLog.groupBy({
      by: ["agentId"],
      where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } },
      _sum: { costUsd: true },
    }),
    db.authorizationRequest.groupBy({
      by: ["agentId"],
      where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } },
      _sum: { amountUsd: true },
    }),
    db.authorizationRequest.groupBy({
      by: ["agentId"],
      where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } },
      _sum: { amountUsd: true },
    }),
    db.grant.findMany({
      where: {
        walletId: { in: walletIds },
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { walletId: true, resourceJson: true, constraintsJson: true },
    }),
    db.pendingApproval.groupBy({
      by: ["walletId"],
      where: { walletId: { in: walletIds }, status: "pending" },
      _count: true,
    }),
    db.authorizationRequest.groupBy({
      by: ["agentId", "status"],
      where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } },
      _count: true,
    }),
    db.tokenLog.groupBy({
      by: ["model"],
      where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
  ])

  for (const row of tokToday) {
    const bucket = ownBuckets.get(agentToWallet.get(row.agentId) ?? "")
    if (bucket) bucket.tokenTodayUsd += row._sum.costUsd ?? 0
  }
  for (const row of spendToday) {
    const bucket = ownBuckets.get(agentToWallet.get(row.agentId) ?? "")
    if (bucket) bucket.spendTodayUsd += row._sum.amountUsd ?? 0
  }
  for (const row of spendMonth) {
    const bucket = ownBuckets.get(agentToWallet.get(row.agentId) ?? "")
    if (bucket) bucket.spendMonthUsd += row._sum.amountUsd ?? 0
  }
  for (const grant of activeGrants) {
    const bucket = ownBuckets.get(grant.walletId)
    if (!bucket) continue
    bucket.activeGrantCount += 1
    bucket.activeGrantUsd += grantAuthorityUsd(grant.resourceJson, grant.constraintsJson)
  }
  for (const row of pendingApprovals) {
    const bucket = ownBuckets.get(row.walletId)
    if (bucket) bucket.pendingApprovals += row._count
  }
  for (const row of decisions) {
    const bucket = ownBuckets.get(agentToWallet.get(row.agentId) ?? "")
    if (!bucket) continue
    if (row.status === "denied") bucket.deniedMonth += row._count
    if (row.status === "escalated") bucket.escalatedMonth += row._count
  }

  const rows = wallets.map((wallet): PoolRow => {
    const ids = subtreeIds(wallet.id, childrenOf)
    const rollup = ids.reduce((sum, id) => addBucket(sum, ownBuckets.get(id) ?? emptyBucket()), emptyBucket())
    const ownCapUsd = wallet.policy?.subtreeDailyCapUsd == null ? null : wallet.policy.subtreeDailyCapUsd / 100
    const chain = capChain(wallet, walletById)
    const inheritedCaps = chain.filter((cap) => cap.walletId !== wallet.id)
    const inheritedCapUsd = inheritedCaps.length ? Math.min(...inheritedCaps.map((cap) => cap.capUsd)) : null
    const capUsd = chain.length ? Math.min(...chain.map((cap) => cap.capUsd)) : null
    const capSource = ownCapUsd !== null ? "custom" : inheritedCapUsd !== null ? "inherited" : "uncapped"
    return {
      ...wallet,
      ...rollup,
      ownCapUsd,
      inheritedCapUsd,
      capUsd,
      capSource,
      childCount: childrenOf.get(wallet.id)?.length ?? 0,
      depth: depthOf(wallet, walletById),
      status: poolStatus(rollup.spendTodayUsd, capUsd),
    }
  }).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))

  const modelTotal = modelCosts.reduce((sum, row) => sum + (row._sum.costUsd ?? 0), 0)
  const largestModel = modelCosts[0]
  const largestModelShare = modelTotal > 0 ? (largestModel?._sum.costUsd ?? 0) / modelTotal : 0

  return { rows, agents, truncated, modelCosts, modelTotal, largestModelShare }
}

function CapMeter({ pool }: { pool: PoolRow }) {
  const meta = statusMeta[pool.status]
  const pressure = spendCapPressure(pool.spendTodayUsd, pool.capUsd)
  const width = pressure === null ? 0 : Math.min(100, Math.round(pressure * 100))
  // No surprises: linear end-of-day projection per pool — where the burn is
  // heading, and when the cap gets hit if the pace holds.
  const pace = dailyPace(pool.spendTodayUsd, pool.capUsd, new Date())
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">Effective cap</span>
        <span className="font-mono text-xs text-muted-foreground">
          <span className={meta.text}>{dollars(pool.spendTodayUsd)}</span>
          {pool.capUsd !== null ? ` / ${dollars(pool.capUsd)}` : " / uncapped"}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${width}%` }} />
      </div>
      {pace.onPace !== null && pool.status !== "over_cap" && (
        <p className={`mt-1.5 text-[11px] ${pace.willExhaust ? "text-amber-400" : "text-muted-foreground"}`}>
          on pace for {dollars(pace.onPace)} today
          {pace.exhaustAt && ` · cap hit ~${pace.exhaustAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </p>
      )}
    </div>
  )
}

function PoolLedgerRow({ pool, rootId }: { pool: PoolRow; rootId: string }) {
  const meta = statusMeta[pool.status]
  const capSourceText = pool.capSource === "custom"
    ? `custom ${capLabel(pool.ownCapUsd)}`
    : pool.capSource === "inherited"
      ? `inherits ${capLabel(pool.inheritedCapUsd)}`
      : "no hard cap"
  return (
    <div className="grid gap-3 border-t border-border py-4 first:border-t-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)_minmax(220px,1fr)] lg:items-center">
      <div className="min-w-0" style={{ paddingLeft: `${Math.min(pool.depth, 4) * 16}px` }}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{pool.name}</p>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {pool.id === rootId ? "root" : pool.depth === 1 ? "delegated" : "nested"}
          </span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>{meta.label}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {pool.activeAgentCount}/{pool.agentCount} agents active
          {pool.childCount > 0 ? ` · ${pool.childCount} child pool${pool.childCount > 1 ? "s" : ""}` : ""}
          {` · ${capSourceText}`}
        </p>
      </div>

      <CapMeter pool={pool} />

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-2">
        <div>
          <p className="text-muted-foreground">Delegated</p>
          <p className="mt-1 font-mono text-muted-foreground">{dollars(pool.delegatedDailyUsd)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Tokens</p>
          <p className="mt-1 font-mono text-muted-foreground">{dollars(pool.tokenTodayUsd)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Grants</p>
          <p className="mt-1 font-mono text-muted-foreground">{pool.activeGrantCount} · {dollars(pool.activeGrantUsd)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Approvals</p>
          <p className="mt-1 font-mono text-muted-foreground">{pool.pendingApprovals}</p>
        </div>
      </div>
    </div>
  )
}

export default async function PoolsPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const pools = await getPools(view.id)
  const rootPool = pools.rows.find((pool) => pool.id === view.id) ?? pools.rows[0]
  const pressure = rootPool ? spendCapPressure(rootPool.spendTodayUsd, rootPool.capUsd) : null
  const moves = rootPool
    ? allocationMoves({
      capUsd: rootPool.capUsd,
      spendTodayUsd: rootPool.spendTodayUsd,
      delegatedDailyUsd: rootPool.delegatedDailyUsd,
      activeGrantUsd: rootPool.activeGrantUsd,
      pendingApprovals: rootPool.pendingApprovals,
      deniedMonth: rootPool.deniedMonth,
      escalatedMonth: rootPool.escalatedMonth,
      modelCount: pools.modelCosts.length,
      largestModelShare: pools.largestModelShare,
    })
    : []
  const totalTokenBudget = rootPool?.delegatedTokenDailyUsd ?? 0
  const currentStrategy = rootPool?.capUsd === null
    ? "Uncapped observation"
    : rootPool?.status === "hot" || rootPool?.status === "over_cap"
      ? "Constrained allocation"
      : "Approval-aware autonomy"

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Budget pools &amp; allocation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Delegated budgets — child wallets whose spend rolls up here, with hard caps you set or split from the parent.
        </p>
      </div>
        {rootPool && (
          <Badge className={`${statusMeta[rootPool.status].badge} border`}>
            {statusMeta[rootPool.status].label}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <WalletCards className="h-3.5 w-3.5" />
              Root pool cap
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="break-words font-mono text-2xl font-semibold leading-tight">{capLabel(rootPool?.capUsd ?? null)}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              Agent authority
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{dollars(rootPool?.delegatedDailyUsd ?? 0)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dollars(totalTokenBudget)} token budget</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Spend today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{dollars(rootPool?.spendTodayUsd ?? 0)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{pressure === null ? "no cap pressure" : `${pct(pressure)} of cap`}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Route className="h-3.5 w-3.5" />
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="break-words text-base font-semibold leading-snug text-foreground">{currentStrategy}</p>
            <p className="mt-1 text-xs text-muted-foreground">{moves.length} allocation signal{moves.length === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Authority controls</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {view.isSession ? (
            <PoolControls
              pools={pools.rows.map((pool) => ({
                id: pool.id,
                name: pool.name,
                parentId: pool.parentId,
                ownCapUsd: pool.ownCapUsd,
                effectiveCapUsd: pool.capUsd,
                capSource: pool.capSource,
                childCount: pool.childCount,
              }))}
              agents={pools.agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                walletId: agent.walletId,
                isActive: agent.isActive,
              }))}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {["Create delegated pool", "Apply allocation", "Set pool cap", "Move agent"].map((label) => (
                <div key={label} className="rounded-md border border-border bg-card/35 p-4">
                  <p className="text-sm font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Log in to edit authority.</p>
                </div>
              ))}
              <Link href="/login" className="inline-flex w-fit rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-emerald-400 lg:col-span-2 xl:col-span-4">
                Log in
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <Card className="border-border bg-card">
          <CardHeader className="px-5 pt-5 pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Authority pools</CardTitle>
              {pools.truncated && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  truncated
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {pools.rows.length === 0 && (
              <EmptyState
                title="No pools yet"
                hint="A pool is a child wallet with its own budget that rolls up to this one — one per team or project. Create a delegated pool with the controls above, and its burn appears here."
              />
            )}
            <div>
              {pools.rows.map((pool) => (
                <PoolLedgerRow key={pool.id} pool={pool} rootId={view.id} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Smart allocation preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5">
            {moves.map((move) => (
              <div key={move.id} className={`rounded-md border px-3 py-3 ${moveToneClass[move.tone]}`}>
                <p className="text-sm font-medium text-foreground">{move.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{move.detail}</p>
                <p className="mt-2 text-xs text-muted-foreground">{move.impact}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Model allocation · this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {pools.modelCosts.length === 0 && (
              <EmptyState
                title="No token usage yet"
                hint="Once agents in any pool start burning tokens, per-model costs land here."
              />
            )}
            <div className="space-y-3">
              {pools.modelCosts.slice(0, 6).map((model) => {
                const cost = model._sum.costUsd ?? 0
                const share = pools.modelTotal > 0 ? cost / pools.modelTotal : 0
                return (
                  <div key={model.model}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-mono text-xs text-muted-foreground">{model.model}</p>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{dollars(cost)} · {pct(share)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current envelope</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Active grant exposure</p>
                <p className="mt-1 font-mono text-lg text-foreground">{dollars(rootPool?.activeGrantUsd ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{rootPool?.activeGrantCount ?? 0} active grants</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Month approved spend</p>
                <p className="mt-1 font-mono text-lg text-foreground">{dollars(rootPool?.spendMonthUsd ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{dollars(rootPool?.tokenTodayUsd ?? 0)} tokens today</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending approvals</p>
                <p className="mt-1 font-mono text-lg text-foreground">{rootPool?.pendingApprovals ?? 0}</p>
                <Link href="/dashboard/approvals" className="text-xs text-emerald-400 hover:text-primary">Open inbox</Link>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Denied this month</p>
                <p className="mt-1 font-mono text-lg text-foreground">{rootPool?.deniedMonth ?? 0}</p>
                <Link href="/dashboard/spend" className="text-xs text-emerald-400 hover:text-primary">Open spend</Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
