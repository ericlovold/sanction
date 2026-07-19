import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd, fmtCount } from "@/lib/format"
import { hasRole } from "@/lib/roles"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Dashboard",
  description: "Where you are on AI spend — approvals, budgets, and allocation at a glance.",
}

// Provider palette — validated with the dataviz six-checks (light surface):
// lightness band, chroma floor, CVD ΔE, normal-vision floor, contrast all PASS.
// Tritan worst-pair sits in the 6–8 band → segments carry 2px gaps + direct
// labels + legend as the required secondary encoding.
const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "#169065",
  OpenAI: "#2e69b2",
  Google: "#b88513",
  Other: "#953c41",
}
const PROVIDER_ORDER = ["Anthropic", "OpenAI", "Google", "Other"]

function providerOf(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "Anthropic"
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.includes("openai")) return "OpenAI"
  if (m.includes("gemini")) return "Google"
  return "Other"
}

function startOfMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfQuarter(): Date {
  const d = new Date()
  d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1)
  d.setHours(0, 0, 0, 0)
  return d
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400_000)
}
// "9238m" is unreadable — waiting time renders at the largest sensible unit.
function humanAge(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

async function getOverview(walletId: string) {
  const monthStart = startOfMonth()
  const { ids: walletIds } = await subtreeWalletIds(walletId)
  const agents = await db.agent.findMany({
    where: { walletId: { in: walletIds } },
    select: { id: true, name: true, isActive: true, walletId: true },
  })
  const agentIds = agents.map((a) => a.id)
  const inAgents = { agentId: { in: agentIds } }

  const [policy, statusGroups, tokenModelGroups, tokenWeek, tokenQuarter, spendWeek, spendQuarter, pending, pendingTotal, children, tokenByAgent, spendByAgent, firstAuth, firstToken] =
    await Promise.all([
      db.policy.findUnique({ where: { walletId }, select: { monthlyTokenBudgetUsd: true, monthlySpendBudgetUsd: true, dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true } }),
      db.authorizationRequest.groupBy({
        by: ["status"],
        where: { ...inAgents, createdAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { amountUsd: true },
      }),
      db.tokenLog.groupBy({
        by: ["model"],
        where: { ...inAgents, createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
      db.tokenLog.aggregate({ where: { ...inAgents, createdAt: { gte: daysAgo(7) } }, _sum: { costUsd: true } }),
      db.tokenLog.aggregate({ where: { ...inAgents, createdAt: { gte: startOfQuarter() } }, _sum: { costUsd: true } }),
      db.authorizationRequest.aggregate({ where: { ...inAgents, status: "approved", createdAt: { gte: daysAgo(7) } }, _sum: { amountUsd: true } }),
      db.authorizationRequest.aggregate({ where: { ...inAgents, status: "approved", createdAt: { gte: startOfQuarter() } }, _sum: { amountUsd: true } }),
      db.pendingApproval.findMany({
        where: { walletId: { in: walletIds }, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: { id: true, agentId: true, actionType: true, reason: true, resourceJson: true, createdAt: true },
      }),
      db.pendingApproval.count({ where: { walletId: { in: walletIds }, status: "pending" } }),
      db.wallet.findMany({ where: { parentId: walletId }, select: { id: true, name: true } }),
      db.tokenLog.groupBy({ by: ["agentId"], where: { ...inAgents, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
      db.authorizationRequest.groupBy({ by: ["agentId"], where: { ...inAgents, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
      db.authorizationRequest.findFirst({ where: inAgents, select: { id: true } }),
      db.tokenLog.findFirst({ where: inAgents, select: { id: true } }),
    ])

  const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g])) as Record<
    string,
    { _count: { _all: number }; _sum: { amountUsd: number | null } }
  >
  const monthTokenCost = tokenModelGroups.reduce((s, g) => s + (g._sum.costUsd ?? 0), 0)

  // Provider allocation (month token cost), fixed order — never cycled.
  const providerTotals = new Map<string, number>()
  for (const g of tokenModelGroups) {
    const p = providerOf(g.model)
    providerTotals.set(p, (providerTotals.get(p) ?? 0) + (g._sum.costUsd ?? 0))
  }
  const providers = PROVIDER_ORDER.map((name) => ({ name, value: providerTotals.get(name) ?? 0 })).filter((p) => p.value > 0)

  // Department (child-wallet) allocation, month: token cost + approved spend.
  const agentWallet = new Map(agents.map((a) => [a.id, a.walletId]))
  const deptTotals = new Map<string, { tokens: number; spend: number }>()
  const bump = (aid: string, field: "tokens" | "spend", v: number) => {
    const wid = agentWallet.get(aid)
    if (!wid) return
    const cur = deptTotals.get(wid) ?? { tokens: 0, spend: 0 }
    cur[field] += v
    deptTotals.set(wid, cur)
  }
  for (const g of tokenByAgent) bump(g.agentId, "tokens", g._sum.costUsd ?? 0)
  for (const g of spendByAgent) bump(g.agentId, "spend", g._sum.amountUsd ?? 0)
  const departments = children
    .map((c) => ({ name: c.name, ...(deptTotals.get(c.id) ?? { tokens: 0, spend: 0 }) }))
    .filter((d) => d.tokens > 0 || d.spend > 0)
    .sort((a, b) => b.tokens + b.spend - (a.tokens + a.spend))
    .slice(0, 8)

  const agentName = new Map(agents.map((a) => [a.id, a.name]))
  const decisions = pending.map((p) => {
    const res = (p.resourceJson ?? {}) as Record<string, unknown>
    const amount = typeof res.amount_usd === "number" ? res.amount_usd : typeof res.amountUsd === "number" ? res.amountUsd : null
    const merchant = typeof res.merchant === "string" ? res.merchant : typeof res.resource === "string" ? res.resource : null
    return {
      id: p.id,
      agent: agentName.get(p.agentId) ?? "agent",
      actionType: p.actionType,
      reason: p.reason,
      merchant,
      amount,
      age: humanAge(Date.now() - p.createdAt.getTime()),
    }
  })

  return {
    agents,
    policy,
    monthTokenCost,
    monthSpend: byStatus.approved?._sum.amountUsd ?? 0,
    counts: {
      approved: byStatus.approved?._count._all ?? 0,
      denied: byStatus.denied?._count._all ?? 0,
      escalated: byStatus.escalated?._count._all ?? 0,
      pendingTotal,
    },
    week: { tokens: tokenWeek._sum.costUsd ?? 0, spend: spendWeek._sum.amountUsd ?? 0 },
    quarter: { tokens: tokenQuarter._sum.costUsd ?? 0, spend: spendQuarter._sum.amountUsd ?? 0 },
    providers,
    departments,
    decisions,
    hasActivity: !!(firstAuth || firstToken),
  }
}

// SVG donut, server-rendered: thin ring, 2px surface gaps between segments
// (the secondary encoding the palette validation requires), <title> hover.
function donutSegments(providers: { name: string; value: number }[]) {
  const total = providers.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return []
  const R = 52
  const C = 2 * Math.PI * R
  const gapPx = 2
  let offset = 0
  return providers.map((p) => {
    const frac = p.value / total
    const len = Math.max(0, frac * C - gapPx)
    const seg = { ...p, frac, dasharray: `${len} ${C - len}`, dashoffset: -offset }
    offset += frac * C
    return seg
  })
}

function BudgetBar({ label, actual, budgetUsd }: { label: string; actual: number; budgetUsd: number | null }) {
  const pctNum = budgetUsd && budgetUsd > 0 ? Math.round((actual / budgetUsd) * 100) : null
  const width = pctNum === null ? 0 : Math.min(100, pctNum)
  const over = pctNum !== null && pctNum > 100
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {fmtUsd(actual)}
          {budgetUsd !== null ? (
            <span className="text-muted-foreground"> / {fmtUsd(budgetUsd)} · {pctNum}%</span>
          ) : (
            <span className="text-muted-foreground"> · no monthly cap set</span>
          )}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-muted">
        {pctNum !== null && (
          <div
            className={`h-2 rounded-full ${over ? "bg-red-400" : "bg-primary"}`}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  )
}

export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const o = await getOverview(view.id)
  const asked = o.counts.approved + o.counts.denied + o.counts.escalated
  const segments = donutSegments(o.providers)
  const maxDept = Math.max(1, ...o.departments.map((d) => d.tokens + d.spend))

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {view.isSession && !o.hasActivity && (
        <Card className="border-emerald-500/25 bg-emerald-500/[0.04]">
          <CardContent className="px-5 py-4 text-sm">
            <p className="font-semibold text-primary">Get started</p>
            <ol className="mt-2 space-y-1 text-muted-foreground">
              <li>1. Create an agent below — you get a key and a one-line test call.</li>
              <li>2. Run it: watch Sanction approve a $5 and escalate a $40.</li>
              <li>3. The decisions land here. Then drop the key into your real agent.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      {/* The sentence — what happened this month, in one read */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Your agents asked to do <span className="font-mono">{fmtCount(asked)}</span> things this month.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sanction approved {fmtCount(o.counts.approved)} ({fmtUsd(o.monthSpend)} authorized)
          {o.counts.pendingTotal > 0 && <>, paused <span className="text-amber-400 font-medium">{o.counts.pendingTotal}</span> for your decision</>}
          , and blocked {fmtCount(o.counts.denied)} — every one on the signed record.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Asked", value: fmtCount(asked), sub: "authorization requests", cls: "" },
          { label: "Approved", value: fmtCount(o.counts.approved), sub: `${fmtUsd(o.monthSpend)} authorized`, cls: "text-primary" },
          { label: "Paused for you", value: fmtCount(o.counts.pendingTotal), sub: "awaiting your decision", cls: o.counts.pendingTotal > 0 ? "text-amber-300" : "" },
          { label: "Blocked", value: fmtCount(o.counts.denied), sub: "stopped by policy", cls: o.counts.denied > 0 ? "text-red-300" : "" },
        ].map((t) => (
          <Card key={t.label} className="bg-card border-border">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-normal">{t.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-mono font-semibold ${t.cls}`}>{t.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Decisions waiting — the product's dramatic moment, promoted to hero */}
      <Card className={`bg-card border-border ${o.decisions.length > 0 ? "border-amber-500/30" : ""}`}>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-baseline justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">Decisions waiting on you</CardTitle>
          {o.counts.pendingTotal > 0 && (
            <Link href="/dashboard/approvals" className="text-xs text-amber-300 hover:underline underline-offset-2">
              Review all {o.counts.pendingTotal} →
            </Link>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {o.decisions.length === 0 && (
            <EmptyState
              title="Nothing waiting on you"
              hint="When an agent's request crosses your escalation line, it pauses here until you decide — approve it and the agent gets a single-use grant to retry with."
            />
          )}
          {o.decisions.map((d) => (
            <Link
              key={d.id}
              href="/dashboard/approvals"
              className="flex items-center justify-between gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5 text-sm transition-colors hover:border-amber-500/40"
            >
              <div className="min-w-0">
                <p className="truncate">
                  <span className="text-amber-200 font-medium">{d.agent}</span>
                  <span className="text-muted-foreground"> wants </span>
                  {d.merchant ?? d.actionType}
                  {d.amount !== null && <span className="font-mono"> · {fmtUsd(d.amount)}</span>}
                </p>
                {d.reason && <p className="truncate text-xs text-muted-foreground mt-0.5">{d.reason}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground font-mono">{d.age}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Where you are on AI spend */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Where you are on AI spend — this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <BudgetBar label="LLM tokens" actual={o.monthTokenCost} budgetUsd={o.policy?.monthlyTokenBudgetUsd != null ? o.policy.monthlyTokenBudgetUsd / 100 : null} />
            <BudgetBar label="Authorized spend" actual={o.monthSpend} budgetUsd={o.policy?.monthlySpendBudgetUsd != null ? o.policy.monthlySpendBudgetUsd / 100 : null} />
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
              <div>
                <p className="text-muted-foreground">Last 7 days</p>
                <p className="mt-0.5 font-mono">{fmtUsd(o.week.tokens)} tokens · {fmtUsd(o.week.spend)} spend</p>
              </div>
              <div>
                <p className="text-muted-foreground">Quarter to date</p>
                <p className="mt-0.5 font-mono">{fmtUsd(o.quarter.tokens)} tokens · {fmtUsd(o.quarter.spend)} spend</p>
              </div>
            </div>
            <Link href="/dashboard/spend" className="inline-block text-xs text-muted-foreground underline-offset-2 hover:underline">
              Full analytics — spend, tokens, burn →
            </Link>
          </CardContent>
        </Card>

        {/* Token cost by provider — validated categorical palette */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Token cost by provider — this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {segments.length === 0 ? (
              <EmptyState title="No token usage yet this month" hint="Once your agents make LLM calls (or you route through the gateway), provider allocation shows up here." />
            ) : (
              <div className="flex items-center gap-6">
                <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Token cost by provider">
                  {segments.map((s) => (
                    <circle
                      key={s.name}
                      cx="64" cy="64" r="52"
                      fill="none"
                      stroke={PROVIDER_COLORS[s.name]}
                      strokeWidth="16"
                      strokeDasharray={s.dasharray}
                      strokeDashoffset={s.dashoffset}
                      transform="rotate(-90 64 64)"
                    >
                      <title>{`${s.name}: ${fmtUsd(s.value)} (${Math.round(s.frac * 100)}%)`}</title>
                    </circle>
                  ))}
                  <text x="64" y="60" textAnchor="middle" className="fill-current" fontSize="13" fontFamily="monospace" fontWeight="600">
                    {fmtUsd(o.monthTokenCost)}
                  </text>
                  <text x="64" y="76" textAnchor="middle" className="fill-current" fontSize="9" opacity="0.55">
                    tokens · month
                  </text>
                </svg>
                <ul className="space-y-1.5 text-sm min-w-0">
                  {segments.map((s) => (
                    <li key={s.name} className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: PROVIDER_COLORS[s.name] }} />
                      <span className="text-muted-foreground">{s.name}</span>
                      <span className="ml-auto font-mono text-xs">{fmtUsd(s.value)} · {Math.round(s.frac * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By department — only when the wallet tree has children with usage */}
      {o.departments.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">By department — this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2.5">
            {o.departments.map((d) => {
              const total = d.tokens + d.spend
              return (
                <div key={d.name}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground truncate">{d.name}</span>
                    <span className="font-mono text-xs">{fmtUsd(total)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((total / maxDept) * 100))}%` }} />
                  </div>
                </div>
              )
            })}
            <Link href="/dashboard/pools" className="inline-block pt-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
              Pools — caps and allocation strategies →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Seats live on their own page; keep the count and the admin on-ramp */}
      <Card className="bg-card border-border">
        <CardContent className="px-4 py-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {fmtCount(o.agents.filter((a) => a.isActive).length)} active seats · {fmtCount(o.agents.length)} registered
          </p>
          <Link href="/dashboard/agents" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Manage seats →
          </Link>
        </CardContent>
      </Card>
      {hasRole(view.role, "admin") && (
        <Card className="bg-card border-border">
          <CardContent className="px-4 py-4">
            <p className="mb-2 text-xs text-muted-foreground">Add an agent — get a scoped key + a test call:</p>
            <AgentCreator />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
