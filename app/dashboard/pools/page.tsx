import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle, GitBranch, Route, ShieldCheck, WalletCards } from "lucide-react"
import { db } from "@/lib/db"
import { allocationMoves, grantAuthorityUsd, poolStatus, spendCapPressure, type PoolStatus } from "@/lib/budgetPools"
import { AccountControl } from "@/components/account-control"
import { DashboardNav } from "@/components/dashboard-nav"
import { PoolControls } from "@/components/pool-controls"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getViewWallet } from "@/lib/session"
import { dailyPace } from "@/lib/burn"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Pools",
  description: "Budget pools, delegated authority, and allocation strategy for autonomous work.",
}

const MAX_DEPTH = 6
const MAX_NODES = 500

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
    badge: "border-zinc-700 bg-zinc-800 text-zinc-300",
    bar: "bg-zinc-500",
    text: "text-zinc-300",
  },
  clear: {
    label: "clear",
    badge: "border-emerald-500/20 bg-emerald-500/15 text-emerald-400",
    bar: "bg-emerald-500",
    text: "text-emerald-300",
  },
}

const moveToneClass = {
  emerald: "border-emerald-500/20 bg-emerald-500/[0.04]",
  amber: "border-amber-500/20 bg-amber-500/[0.04]",
  red: "border-red-500/20 bg-red-500/[0.04]",
  zinc: "border-zinc-800 bg-zinc-950/40",
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
  const root = await db.wallet.findUnique({
    where: { id: rootId },
    select: {
      id: true,
      name: true,
      parentId: true,
      policy: { select: { dailySpendBudgetUsd: true, dailyTokenBudgetUsd: true, subtreeDailyCapUsd: true } },
    },
  })
  if (!root) return { wallets: [], truncated: false }

  const wallets: WalletNode[] = [root]
  let frontier = [root.id]
  let truncated = false

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const children = await db.wallet.findMany({
      where: { parentId: { in: frontier } },
      select: {
        id: true,
        name: true,
        parentId: true,
        policy: { select: { dailySpendBudgetUsd: true, dailyTokenBudgetUsd: true, subtreeDailyCapUsd: true } },
      },
    })
    if (!children.length) break
    if (wallets.length + children.length > MAX_NODES) {
      truncated = true
      break
    }
    wallets.push(...children)
    frontier = children.map((child) => child.id)
  }

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
        <span className="text-xs text-zinc-500">Effective cap</span>
        <span className="font-mono text-xs text-zinc-500">
          <span className={meta.text}>{dollars(pool.spendTodayUsd)}</span>
          {pool.capUsd !== null ? ` / ${dollars(pool.capUsd)}` : " / uncapped"}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${width}%` }} />
      </div>
      {pace.onPace !== null && pool.status !== "over_cap" && (
        <p className={`mt-1.5 text-[11px] ${pace.willExhaust ? "text-amber-400" : "text-zinc-600"}`}>
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
    <div className="grid gap-3 border-t border-zinc-800 py-4 first:border-t-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)_minmax(220px,1fr)] lg:items-center">
      <div className="min-w-0" style={{ paddingLeft: `${Math.min(pool.depth, 4) * 16}px` }}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-zinc-200">{pool.name}</p>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            {pool.id === rootId ? "root" : pool.depth === 1 ? "delegated" : "nested"}
          </span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>{meta.label}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          {pool.activeAgentCount}/{pool.agentCount} agents active
          {pool.childCount > 0 ? ` · ${pool.childCount} child pool${pool.childCount > 1 ? "s" : ""}` : ""}
          {` · ${capSourceText}`}
        </p>
      </div>

      <CapMeter pool={pool} />

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-2">
        <div>
          <p className="text-zinc-600">Delegated</p>
          <p className="mt-1 font-mono text-zinc-300">{dollars(pool.delegatedDailyUsd)}</p>
        </div>
        <div>
          <p className="text-zinc-600">Tokens</p>
          <p className="mt-1 font-mono text-zinc-300">{dollars(pool.tokenTodayUsd)}</p>
        </div>
        <div>
          <p className="text-zinc-600">Grants</p>
          <p className="mt-1 font-mono text-zinc-300">{pool.activeGrantCount} · {dollars(pool.activeGrantUsd)}</p>
        </div>
        <div>
          <p className="text-zinc-600">Approvals</p>
          <p className="mt-1 font-mono text-zinc-300">{pool.pendingApprovals}</p>
        </div>
      </div>
    </div>
  )
}

export default async function PoolsPage() {
  const view = await getViewWallet()
  if (!view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-zinc-400">No wallet to show.</p>
          <div className="flex items-center justify-center gap-3 text-sm">
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link>
            <Link href="/start" className="text-zinc-400 hover:text-zinc-200">Create a wallet</Link>
          </div>
        </div>
      </div>
    )
  }

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight transition-colors hover:text-zinc-300">Sanction</Link>
          <p className="text-sm text-zinc-500">{view.name} · budget pools &amp; allocation</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {rootPool && (
            <Badge className={`${statusMeta[rootPool.status].badge} border`}>
              {statusMeta[rootPool.status].label}
            </Badge>
          )}
          <DashboardNav active="pools" />
          <AccountControl view={view} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-zinc-500">
              <WalletCards className="h-3.5 w-3.5" />
              Root pool cap
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="break-words font-mono text-2xl font-semibold leading-tight">{capLabel(rootPool?.capUsd ?? null)}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-zinc-500">
              <GitBranch className="h-3.5 w-3.5" />
              Agent authority
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{dollars(rootPool?.delegatedDailyUsd ?? 0)}</p>
            <p className="mt-1 text-xs text-zinc-600">{dollars(totalTokenBudget)} token budget</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-zinc-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              Spend today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{dollars(rootPool?.spendTodayUsd ?? 0)}</p>
            <p className="mt-1 text-xs text-zinc-600">{pressure === null ? "no cap pressure" : `${pct(pressure)} of cap`}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-normal text-zinc-500">
              <Route className="h-3.5 w-3.5" />
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="break-words text-base font-semibold leading-snug text-zinc-100">{currentStrategy}</p>
            <p className="mt-1 text-xs text-zinc-600">{moves.length} allocation signal{moves.length === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-zinc-300">Authority controls</CardTitle>
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
                <div key={label} className="rounded-md border border-zinc-800 bg-zinc-950/35 p-4">
                  <p className="text-sm font-medium text-zinc-300">{label}</p>
                  <p className="mt-1 text-xs text-zinc-600">Log in to edit authority.</p>
                </div>
              ))}
              <Link href="/login" className="inline-flex w-fit rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 lg:col-span-2 xl:col-span-4">
                Log in
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-5 pt-5 pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium text-zinc-300">Authority pools</CardTitle>
              {pools.truncated && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  truncated
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {pools.rows.length === 0 && <p className="text-sm text-zinc-600">No pools found.</p>}
            <div>
              {pools.rows.map((pool) => (
                <PoolLedgerRow key={pool.id} pool={pool} rootId={view.id} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Smart allocation preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5">
            {moves.map((move) => (
              <div key={move.id} className={`rounded-md border px-3 py-3 ${moveToneClass[move.tone]}`}>
                <p className="text-sm font-medium text-zinc-200">{move.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{move.detail}</p>
                <p className="mt-2 text-xs text-zinc-400">{move.impact}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Model allocation · this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {pools.modelCosts.length === 0 && <p className="text-sm text-zinc-600">No token usage yet</p>}
            <div className="space-y-3">
              {pools.modelCosts.slice(0, 6).map((model) => {
                const cost = model._sum.costUsd ?? 0
                const share = pools.modelTotal > 0 ? cost / pools.modelTotal : 0
                return (
                  <div key={model.model}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-mono text-xs text-zinc-300">{model.model}</p>
                      <span className="shrink-0 font-mono text-xs text-zinc-500">{dollars(cost)} · {pct(share)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Current envelope</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-zinc-600">Active grant exposure</p>
                <p className="mt-1 font-mono text-lg text-zinc-200">{dollars(rootPool?.activeGrantUsd ?? 0)}</p>
                <p className="text-xs text-zinc-600">{rootPool?.activeGrantCount ?? 0} active grants</p>
              </div>
              <div>
                <p className="text-xs text-zinc-600">Month approved spend</p>
                <p className="mt-1 font-mono text-lg text-zinc-200">{dollars(rootPool?.spendMonthUsd ?? 0)}</p>
                <p className="text-xs text-zinc-600">{dollars(rootPool?.tokenTodayUsd ?? 0)} tokens today</p>
              </div>
              <div>
                <p className="text-xs text-zinc-600">Pending approvals</p>
                <p className="mt-1 font-mono text-lg text-zinc-200">{rootPool?.pendingApprovals ?? 0}</p>
                <Link href="/dashboard/approvals" className="text-xs text-emerald-400 hover:text-emerald-300">Open inbox</Link>
              </div>
              <div>
                <p className="text-xs text-zinc-600">Denied this month</p>
                <p className="mt-1 font-mono text-lg text-zinc-200">{rootPool?.deniedMonth ?? 0}</p>
                <Link href="/dashboard/spend" className="text-xs text-emerald-400 hover:text-emerald-300">Open spend</Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
