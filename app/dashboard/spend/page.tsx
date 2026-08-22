import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { OutcomesSection } from "@/components/outcomes-section"
import { dailyPace, bucketByDay } from "@/lib/burn"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd, fmtCount } from "@/lib/format"
import { RunwayChart } from "@/components/runway-chart"
import { decisionsThisMonth } from "@/lib/decisionMeter"
import { seatHealth, type SeatHealthInput } from "@/lib/seatHealth"
import { decisionCode } from "@/lib/decisions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Spend",
  description: "Token and spend usage across every agent, model, and task.",
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
  // No surprises: linear end-of-day projection so the CFO sees where today is
  // heading, not just where it stands.
  const pace = dailyPace(actual, budget > 0 ? budget : null, new Date())
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          <span className={tone.text}>{format(actual)}</span> / {format(budget)} <span className="text-muted-foreground">· {p}%</span>
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone.bar} transition-all`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      {p >= 100 ? (
        <p className="mt-1 text-[11px] text-red-400">Budget exhausted — new requests are being denied.</p>
      ) : pace.onPace !== null ? (
        <p className={`mt-1 text-[11px] ${pace.willExhaust ? "text-amber-400" : "text-muted-foreground"}`}>
          on pace for {format(pace.onPace)} today
          {pace.exhaustAt && ` · budget hit ~${pace.exhaustAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </p>
      ) : null}
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

  // Analytics roll up the subtree (org-wide burn); the budget bars stay on the
  // root wallet's own policy — the org envelope. Leaf subtree = self, no change.
  const { ids: walletIds } = await subtreeWalletIds(walletId)
  const [wallet, agents] = await Promise.all([
    db.wallet.findUnique({ where: { id: walletId }, include: { policy: true } }),
    db.agent.findMany({
      where: { walletId: { in: walletIds } },
      select: { id: true, name: true, dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true, perTransactionMaxUsd: true, escalateOverUsd: true },
    }),
  ])
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

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)

  const [
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask, tokByAgent, authByAgent, byCategory, decisionMix, trendLogs,
    monthTokenLogs, monthSpendReqs, authByAgentRecent, deniedNotes,
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
    db.tokenLog.findMany({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, select: { createdAt: true, costUsd: true } }),
    db.authorizationRequest.findMany({ where: { ...monthScope, status: "approved" }, select: { createdAt: true, amountUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId", "status"], where: { agentId: { in: agentIds }, createdAt: { gte: weekStart } }, _count: true }),
    db.authorizationRequest.groupBy({ by: ["agentId", "decisionNote"], where: { ...monthScope, status: "denied" }, _count: true }),
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

  // MONO-0: the month's fresh engine decisions, from the counter (allowed tool
  // calls never persist a row, so the row-derived mix undercounts them).
  const decisions = await decisionsThisMonth(walletIds)

  // Month runway: per-day totals since the 1st, for the cumulative chart.
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const tokenByMonthDay = bucketByDay(monthTokenLogs.map((l) => ({ at: l.createdAt, amount: l.costUsd })), monthStart, daysInMonth)
  const spendByMonthDay = bucketByDay(monthSpendReqs.map((r) => ({ at: r.createdAt, amount: r.amountUsd })), monthStart, daysInMonth)

  // Seat health: month vs last-7-days decision mix, plus each seat's most-hit
  // denial code (decisionNote → stable DecisionCode, same mapping agents see).
  const recentByAgent = new Map<string, { approved: number; denied: number; escalated: number }>()
  for (const r of authByAgentRecent) {
    const row = recentByAgent.get(r.agentId) ?? { approved: 0, denied: 0, escalated: 0 }
    if (r.status === "approved") row.approved += r._count
    else if (r.status === "denied") row.denied += r._count
    else if (r.status === "escalated") row.escalated += r._count
    recentByAgent.set(r.agentId, row)
  }
  const topDenialByAgent = new Map<string, { code: string; count: number }>()
  for (const r of deniedNotes) {
    const code = decisionCode("denied", r.decisionNote) ?? "POLICY_DENIED"
    const cur = topDenialByAgent.get(r.agentId)
    if (!cur || r._count > cur.count) topDenialByAgent.set(r.agentId, { code, count: r._count })
  }
  const healthInputs: SeatHealthInput[] = agentIds.map((id) => {
    const m = agentRows.get(id)
    return {
      id,
      name: nameOf.get(id) ?? id,
      month: { approved: m?.approved ?? 0, denied: m?.denied ?? 0, escalated: m?.escalated ?? 0 },
      recent: recentByAgent.get(id) ?? { approved: 0, denied: 0, escalated: 0 },
      topDenial: topDenialByAgent.get(id),
    }
  })
  const seatFlags = seatHealth(healthInputs)

  return {
    wallet, policy: wallet?.policy ?? null,
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask: byTask.filter((t) => (t._sum.costUsd ?? 0) > 0), byCategory,
    agentList, days, trendMax, mix, decisions,
    tokenByMonthDay, spendByMonthDay, seatFlags,
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
    <div className="min-h-screen max-w-6xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Spend &amp; token usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where the money goes — token burn and purchases against their budgets, by agent, model, and task.
        </p>
      </div>

      {/* Budget vs. actual — today */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Today against budget</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-3 grid gap-5 sm:grid-cols-2">
          <BudgetBar label="Token cost" actual={s.tokDay._sum.costUsd ?? 0} budget={tokenBudget} format={fmtUsd} />
          <BudgetBar label="Authorized spend" actual={s.spendDay._sum.amountUsd ?? 0} budget={spendBudget} format={fmtUsd} />
        </CardContent>
      </Card>

      {/* Month runway — cumulative burn vs the monthly cap, exhaust date drawn */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Month runway</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-3 grid gap-5 sm:grid-cols-2">
          <RunwayChart
            label="Token cost"
            dailyTotals={s.tokenByMonthDay}
            capUsd={s.policy?.monthlyTokenBudgetUsd != null ? s.policy.monthlyTokenBudgetUsd / 100 : null}
            now={new Date()}
          />
          <RunwayChart
            label="Authorized spend"
            dailyTotals={s.spendByMonthDay}
            capUsd={s.policy?.monthlySpendBudgetUsd != null ? s.policy.monthlySpendBudgetUsd / 100 : null}
            now={new Date()}
          />
        </CardContent>
      </Card>

      {/* KPI row — this month */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Token cost (month)", value: fmtUsd(s.tokMonth._sum.costUsd ?? 0), sub: `${tokensMonth.toLocaleString()} tokens` },
          { label: "Authorized spend (month)", value: fmtUsd(s.spendMonth._sum.amountUsd ?? 0), sub: `${s.mix.approved ?? 0} approved` },
          { label: "Denied (month)", value: `${s.mix.denied ?? 0}`, sub: "blocked by policy" },
          { label: "Escalated (month)", value: `${s.mix.escalated ?? 0}`, sub: "awaiting a human" },
          { label: "Decisions (month)", value: `${s.decisions}`, sub: "engine verdicts rendered" },
        ].map((k) => (
          <Card key={k.label} className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-1">
              <CardTitle className="text-xs font-normal text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="font-mono text-2xl font-semibold">{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Token cost · last 14 days</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {/* items-end here collapsed the bar columns to content height, so the
              bars' percentage heights resolved against auto and rendered 0px —
              let the columns stretch; they bottom-align internally. */}
          <div className="flex h-32 gap-1.5">
            {s.days.map((d, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[9px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">{fmtUsd(d.cost)}</span>
                <div
                  className="w-full rounded-sm bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors"
                  style={{ height: `${Math.max(2, (d.cost / s.trendMax) * 100)}%` }}
                />
                <span className="text-[9px] font-mono text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Seat health — drift flags, not another table of totals */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Seat health · this month</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {s.seatFlags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No drift flags — no seat is running a hot or climbing denial rate.
            </p>
          ) : (
            <div className="space-y-3">
              {s.seatFlags.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-foreground">
                      {f.name}
                      {f.climbing && (
                        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-400">
                          ▲ denial rate climbing
                        </span>
                      )}
                      {f.hot && (
                        <span className="rounded border border-red-500/25 bg-red-500/10 px-1 py-0.5 text-[9px] font-medium text-red-400">
                          hot
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      denied {Math.round(f.denialRateMonth * 100)}% of decisions this month
                      {f.climbing && ` · ${Math.round(f.denialRateRecent * 100)}% in the last 7 days`}
                      {f.escalationRateMonth > 0 && ` · ${Math.round(f.escalationRateMonth * 100)}% escalated`}
                    </p>
                  </div>
                  {f.topDenial && (
                    <span
                      title={`${f.topDenial.count} denials`}
                      className="ml-3 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {f.topDenial.code} ×{f.topDenial.count}
                    </span>
                  )}
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">
                A seat that keeps hitting the same rule is usually misconfigured, not misbehaving — check its
                budget overrides or the policy&apos;s lists before assuming the worst.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By model */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">By model · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byModel.length === 0 && (
              <EmptyState
                title="No token usage yet"
                hint="Point an agent's model SDK at the Sanction gateway (or log tokens directly) and per-model costs appear here, metered against the daily token budget."
              />
            )}
            <div className="space-y-2">
              {s.byModel.map((m) => (
                <div key={m.model} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-muted-foreground">{m.model}</p>
                    <p className="text-[11px] text-muted-foreground">{m._count._all} calls · {((m._sum.tokensIn ?? 0) + (m._sum.tokensOut ?? 0)).toLocaleString()} tok</p>
                  </div>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">{fmtUsd(m._sum.costUsd ?? 0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By agent */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">By agent · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.agentList.length === 0 && (
              <EmptyState
                title="No agents registered"
                hint="Create an agent on the Agents page — its burn shows up here the moment it starts working."
              />
            )}
            <div className="space-y-2">
              {/* Zero-noise: seats with no activity this month collapse into
                  one summary line instead of a wall of $0.00 rows. */}
              {s.agentList.filter((a) => a.tokens > 0 || a.approved > 0 || a.denied > 0 || a.escalated > 0 || a.spend > 0 || a.tokenCost > 0).map((a) => (
                <div key={a.name} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-muted-foreground">
                      {a.name}
                      {a.override && (
                        <span title={a.override} className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                          custom budget
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.tokens.toLocaleString()} tok · {a.approved} appr
                      {a.denied > 0 && <span className="text-red-400/70"> · {a.denied} deny</span>}
                      {a.escalated > 0 && <span className="text-amber-400/70"> · {a.escalated} esc</span>}
                    </p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="font-mono text-xs text-muted-foreground">{fmtUsd(a.tokenCost)}</p>
                    {a.spend > 0 && <p className="text-[11px] text-muted-foreground">+{fmtUsd(a.spend)} spend</p>}
                  </div>
                </div>
              ))}
              {(() => {
                const idle = s.agentList.filter((a) => a.tokens === 0 && a.approved === 0 && a.denied === 0 && a.escalated === 0 && a.spend === 0 && a.tokenCost === 0).length
                return idle > 0 ? (
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    + {idle} seat{idle === 1 ? "" : "s"} with no activity this month
                  </p>
                ) : null
              })()}
            </div>
          </CardContent>
        </Card>

        {/* By task */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">By task · this month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byTask.length === 0 && (
              <EmptyState
                title="No labeled tasks yet"
                hint="Send a task_label with token logs and costs group by task here — which jobs are worth what they burn."
              />
            )}
            <div className="space-y-2">
              {s.byTask.map((t) => (
                <div key={t.taskLabel ?? "unlabeled"} className="flex items-center justify-between text-sm">
                  <p className="truncate text-muted-foreground">{t.taskLabel ?? "unlabeled"}</p>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">{fmtUsd(t._sum.costUsd ?? 0)} <span className="text-muted-foreground">· {t._count._all}</span></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By category (spend) */}
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Approved spend by category · month</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            {s.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No approved spend yet</p>}
            <div className="space-y-2">
              {s.byCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <p className="truncate text-muted-foreground">{c.category}</p>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">{fmtUsd(c._sum.amountUsd ?? 0)} <span className="text-muted-foreground">· {c._count}</span></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <OutcomesSection rootWalletId={view.id} />

      {/* Policy authoring lives on its own page now. */}
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-between px-5 py-4">
          <span className="text-sm text-muted-foreground">
            {s.policy ? "Budgets, categories, tools, capability rules, and escalation." : "No policy configured yet."}
          </span>
          <Link href="/dashboard/policy" className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            Manage policy →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
