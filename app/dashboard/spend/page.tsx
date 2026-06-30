import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { PolicyEditor } from "@/components/policy-editor"
import { policyToDollars } from "@/lib/policy"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Spend",
  description: "Token and spend usage across every agent, model, and task.",
}

function cost(n: number) {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}
function dollars(n: number) {
  return `$${n.toFixed(2)}`
}
function pct(actual: number, budget: number) {
  if (budget <= 0) return 0
  return Math.min(999, Math.round((actual / budget) * 100))
}
function barTone(p: number) {
  if (p >= 100) return { bar: "bg-red-500", text: "text-red-400" }
  if (p >= 80) return { bar: "bg-amber-500", text: "text-amber-400" }
  return { bar: "bg-emerald-500", text: "text-emerald-400" }
}

function BudgetBar({ label, actual, budget, format }: { label: string; actual: number; budget: number; format: (n: number) => string }) {
  const p = pct(actual, budget)
  const tone = barTone(p)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="font-mono text-xs text-zinc-500">
          <span className={tone.text}>{format(actual)}</span> / {format(budget)} <span className="text-zinc-600">· {p}%</span>
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${tone.bar} transition-all`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      {p >= 100 && <p className="mt-1 text-[11px] text-red-400">Budget exhausted — new requests are being denied.</p>}
    </div>
  )
}

async function getSpend(walletId: string) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const trendStart = new Date()
  trendStart.setDate(trendStart.getDate() - 13)
  trendStart.setHours(0, 0, 0, 0)

  const wallet = await db.wallet.findUnique({ where: { id: walletId }, include: { policy: true } })
  const agents = await db.agent.findMany({
    where: { walletId },
    select: { id: true, name: true, dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true, perTransactionMaxUsd: true, escalateOverUsd: true },
  })
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const overrideOf = new Map(
    agents.map((a) => {
      const parts: string[] = []
      if (a.dailyTokenBudgetUsd != null) parts.push(`token $${a.dailyTokenBudgetUsd / 100}/day`)
      if (a.dailySpendBudgetUsd != null) parts.push(`spend $${a.dailySpendBudgetUsd / 100}/day`)
      if (a.perTransactionMaxUsd != null) parts.push(`per-txn $${a.perTransactionMaxUsd / 100}`)
      if (a.escalateOverUsd != null) parts.push(`escalate $${a.escalateOverUsd / 100}`)
      return [a.id, parts.join(" · ")]
    }),
  )

  const monthScope = { agentId: { in: agentIds }, createdAt: { gte: monthStart } }

  const [
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask, tokByAgent, authByAgent, byCategory, decisionMix, trendLogs,
  ] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.tokenLog.aggregate({ where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true }, _count: { _all: true } }),
    db.authorizationRequest.aggregate({ where: { ...monthScope, status: "approved" }, _sum: { amountUsd: true } }),
    db.tokenLog.groupBy({ by: ["model"], where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    db.tokenLog.groupBy({ by: ["taskLabel"], where: monthScope, _sum: { costUsd: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    db.tokenLog.groupBy({ by: ["agentId"], where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId", "status"], where: monthScope, _sum: { amountUsd: true }, _count: true }),
    db.authorizationRequest.groupBy({ by: ["category"], where: { ...monthScope, status: "approved" }, _sum: { amountUsd: true }, _count: true, orderBy: { _sum: { amountUsd: "desc" } } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: monthScope, _count: true }),
    db.tokenLog.findMany({ where: { agentId: { in: agentIds }, createdAt: { gte: trendStart } }, select: { createdAt: true, costUsd: true } }),
  ])

  // Per-agent merge: token cost + approved spend + decision counts
  const agentRows = new Map<string, { name: string; override: string; tokenCost: number; tokens: number; spend: number; approved: number; denied: number; escalated: number }>()
  for (const id of agentIds) agentRows.set(id, { name: nameOf.get(id) ?? id, override: overrideOf.get(id) ?? "", tokenCost: 0, tokens: 0, spend: 0, approved: 0, denied: 0, escalated: 0 })
  for (const r of tokByAgent) {
    const row = agentRows.get(r.agentId)
    if (row) { row.tokenCost = r._sum.costUsd ?? 0; row.tokens = (r._sum.tokensIn ?? 0) + (r._sum.tokensOut ?? 0) }
  }
  for (const r of authByAgent) {
    const row = agentRows.get(r.agentId)
    if (!row) continue
    if (r.status === "approved") { row.spend += r._sum.amountUsd ?? 0; row.approved += r._count }
    else if (r.status === "denied") row.denied += r._count
    else if (r.status === "escalated") row.escalated += r._count
  }
  const agentList = [...agentRows.values()].sort((a, b) => (b.tokenCost + b.spend) - (a.tokenCost + a.spend))

  // 14-day token-cost trend, bucketed by local day
  const days: { label: string; cost: number }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(trendStart)
    d.setDate(trendStart.getDate() + i)
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, cost: 0 })
  }
  for (const log of trendLogs) {
    const d = new Date(log.createdAt)
    d.setHours(0, 0, 0, 0)
    const idx = Math.round((d.getTime() - trendStart.getTime()) / 86400000)
    if (idx >= 0 && idx < 14) days[idx].cost += log.costUsd
  }
  const trendMax = Math.max(...days.map((d) => d.cost), 0.0001)

  const mix = Object.fromEntries(decisionMix.map((r) => [r.status, r._count])) as Record<string, number>

  return {
    wallet, policy: wallet?.policy ?? null,
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask: byTask.filter((t) => (t._sum.costUsd ?? 0) > 0), byCategory,
    agentList, days, trendMax, mix,
  }
}

export default async function SpendPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const s = await getSpend(view.id)
  const tokenBudget = (s.policy?.dailyTokenBudgetUsd ?? 0) / 100
  const spendBudget = (s.policy?.dailySpendBudgetUsd ?? 0) / 100
  const tokensMonth = (s.tokMonth._sum.tokensIn ?? 0) + (s.tokMonth._sum.tokensOut ?? 0)

  return (
    <>
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Spend</h1>
        <p className="mt-1 text-sm text-zinc-500">Token &amp; spend usage across every agent, model, and task.</p>
      </div>

      {/* Budget vs. actual — today */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-5 pt-5 pb-1">
          <CardTitle className="text-sm font-medium text-zinc-300">Today against budget</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-3 grid gap-5 sm:grid-cols-2">
          <BudgetBar label="Token cost" actual={s.tokDay._sum.costUsd ?? 0} budget={tokenBudget} format={cost} />
          <BudgetBar label="Authorized spend" actual={s.spendDay._sum.amountUsd ?? 0} budget={spendBudget} format={dollars} />
        </CardContent>
      </Card>

      {/* KPI row — this month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Token cost (month)", value: cost(s.tokMonth._sum.costUsd ?? 0), sub: `${tokensMonth.toLocaleString()} tokens` },
          { label: "Authorized spend (month)", value: dollars(s.spendMonth._sum.amountUsd ?? 0), sub: `${s.mix.approved ?? 0} approved` },
          { label: "Denied (month)", value: `${s.mix.denied ?? 0}`, sub: "blocked by policy" },
          { label: "Escalated (month)", value: `${s.mix.escalated ?? 0}`, sub: "awaiting a human" },
        ].map((k) => (
          <Card key={k.label} className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-1">
              <CardTitle className="text-xs font-normal text-zinc-500">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="font-mono text-2xl font-semibold">{k.value}</p>
              <p className="mt-1 text-xs text-zinc-600">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-zinc-300">Token cost · last 14 days</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="flex h-32 items-end gap-1.5">
            {s.days.map((d, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[9px] font-mono text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">{cost(d.cost)}</span>
                <div
                  className="w-full rounded-sm bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors"
                  style={{ height: `${Math.max(2, (d.cost / s.trendMax) * 100)}%` }}
                />
                <span className="text-[9px] font-mono text-zinc-600">{d.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By model */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">By model · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byModel.length === 0 && <p className="text-sm text-zinc-600">No token usage yet</p>}
            <div className="space-y-2">
              {s.byModel.map((m) => (
                <div key={m.model} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-zinc-300">{m.model}</p>
                    <p className="text-[11px] text-zinc-600">{m._count._all} calls · {((m._sum.tokensIn ?? 0) + (m._sum.tokensOut ?? 0)).toLocaleString()} tok</p>
                  </div>
                  <span className="ml-3 shrink-0 font-mono text-xs text-zinc-400">{cost(m._sum.costUsd ?? 0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By agent */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">By agent · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.agentList.length === 0 && <p className="text-sm text-zinc-600">No agents registered</p>}
            <div className="space-y-2">
              {s.agentList.map((a) => (
                <div key={a.name} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-zinc-300">
                      {a.name}
                      {a.override && (
                        <span title={a.override} className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                          custom budget
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      {a.tokens.toLocaleString()} tok · {a.approved} appr
                      {a.denied > 0 && <span className="text-red-400/70"> · {a.denied} deny</span>}
                      {a.escalated > 0 && <span className="text-amber-400/70"> · {a.escalated} esc</span>}
                    </p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="font-mono text-xs text-zinc-400">{cost(a.tokenCost)}</p>
                    {a.spend > 0 && <p className="text-[11px] text-zinc-600">+{dollars(a.spend)} spend</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By task */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">By task · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byTask.length === 0 && <p className="text-sm text-zinc-600">No labeled tasks yet</p>}
            <div className="space-y-2">
              {s.byTask.map((t) => (
                <div key={t.taskLabel ?? "unlabeled"} className="flex items-center justify-between text-sm">
                  <p className="truncate text-zinc-300">{t.taskLabel ?? "unlabeled"}</p>
                  <span className="ml-3 shrink-0 font-mono text-xs text-zinc-400">{cost(t._sum.costUsd ?? 0)} <span className="text-zinc-600">· {t._count._all}</span></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By category (spend) */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">Approved spend by category · month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byCategory.length === 0 && <p className="text-sm text-zinc-600">No approved spend yet</p>}
            <div className="space-y-2">
              {s.byCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <p className="truncate text-zinc-300">{c.category}</p>
                  <span className="ml-3 shrink-0 font-mono text-xs text-zinc-400">{dollars(c._sum.amountUsd ?? 0)} <span className="text-zinc-600">· {c._count}</span></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Policy editor */}
      {s.policy ? (
        <PolicyEditor policy={policyToDollars(s.policy)} editable={view.isSession} />
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="px-5 py-5">
            <p className="text-sm text-zinc-600">No policy configured.</p>
          </CardContent>
        </Card>
      )}
    </>
  )
}
