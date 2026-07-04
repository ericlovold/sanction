import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { getViewWallet } from "@/lib/session"
import { BudgetMeter } from "@/components/budget-meter"
import { dailyPace } from "@/lib/burn"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Dashboard",
  description: "Live agent wallet, spend authorization, and credential governance.",
}

async function getStats(walletId: string) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [agents, policy] = await Promise.all([
    db.agent.findMany({
      where: { walletId },
      select: {
        id: true, name: true, holder: true, isActive: true, apiKeyPrefix: true,
        dailySpendBudgetUsd: true, dailyTokenBudgetUsd: true,
      },
    }),
    db.policy.findUnique({ where: { walletId } }),
  ])
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, spendDay, spendMonth, spendByAgent, tokensByAgent, pendingCount, activeGrantCount, deniedToday, firstAuth, firstToken] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.tokenLog.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true } }),
    db.pendingApproval.count({ where: { walletId, status: "pending" } }),
    db.grant.count({
      where: {
        walletId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
    db.authorizationRequest.count({ where: { agentId: { in: agentIds }, status: "denied", createdAt: { gte: dayStart } } }),
    db.authorizationRequest.findFirst({ where: { agentId: { in: agentIds } }, select: { id: true } }),
    db.tokenLog.findFirst({ where: { agentId: { in: agentIds } }, select: { id: true } }),
  ])

  // Budget runway — the macro numbers. Budgets are enforced PER AGENT (each
  // agent's daily/monthly aggregate vs its effective cap), so the wallet-level
  // capacity is the sum of effective caps across active agents; cents → dollars.
  const active = agents.filter((a) => a.isActive)
  const sumCents = (pick: (a: (typeof agents)[number]) => number | null) =>
    active.reduce((n, a) => n + (pick(a) ?? 0), 0)
  const dailySpendCapUsd = policy ? sumCents((a) => a.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd) / 100 : null
  const dailyTokenCapUsd = policy ? sumCents((a) => a.dailyTokenBudgetUsd ?? policy.dailyTokenBudgetUsd) / 100 : null
  const monthlyCapUsd =
    policy?.monthlySpendBudgetUsd != null ? (active.length * policy.monthlySpendBudgetUsd) / 100 : null

  const spendOf = new Map(spendByAgent.map((r) => [r.agentId, r._sum.amountUsd ?? 0]))
  const tokensOf = new Map(tokensByAgent.map((r) => [r.agentId, r._sum.costUsd ?? 0]))
  const seats = active.map((a) => ({
    id: a.id,
    name: a.name,
    holder: a.holder,
    spentTodayUsd: spendOf.get(a.id) ?? 0,
    tokenTodayUsd: tokensOf.get(a.id) ?? 0,
    dailySpendCapUsd: policy ? (a.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd) / 100 : null,
    dailyTokenCapUsd: policy ? (a.dailyTokenBudgetUsd ?? policy.dailyTokenBudgetUsd) / 100 : null,
  }))

  return {
    agents, tokenDay, spendDay, spendMonth, pendingCount, activeGrantCount, deniedToday,
    hasActivity: !!(firstAuth || firstToken),
    dailySpendCapUsd, dailyTokenCapUsd, monthlyCapUsd, seats,
  }
}


function usd(n: number) {
  return `$${n.toFixed(4)}`
}



export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const {
    agents, tokenDay, spendDay, spendMonth, pendingCount, activeGrantCount, deniedToday, hasActivity,
    dailySpendCapUsd, dailyTokenCapUsd, monthlyCapUsd, seats,
  } = await getStats(view.id)
  const now = new Date()
  const spendToday = spendDay._sum.amountUsd ?? 0
  const tokenToday = tokenDay._sum.costUsd ?? 0
  const spendMonthTotal = spendMonth._sum.amountUsd ?? 0
  const activeAgents = agents.filter((a) => a.isActive).length

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* First-run guidance — only for a logged-in wallet with no activity yet */}
      {view.isSession && !hasActivity && (
        <Card className="border-emerald-500/25 bg-emerald-500/[0.04]">
          <CardContent className="px-5 py-4 text-sm">
            <p className="font-semibold text-emerald-300">Get started</p>
            <ol className="mt-2 space-y-1 text-zinc-400">
              <li>1. Create an agent below — you get a key and a one-line test call.</li>
              <li>2. Run it: watch Sanction approve a $5 and escalate a $40.</li>
              <li>3. The decisions land here. Then drop the key into your real agent.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Operating state */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Pending approvals</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${pendingCount > 0 ? "text-amber-300" : ""}`}>{pendingCount}</p>
            <p className="text-xs text-zinc-600 mt-1">human decisions</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Active grants</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${activeGrantCount > 0 ? "text-emerald-300" : ""}`}>{activeGrantCount}</p>
            <p className="text-xs text-zinc-600 mt-1">outstanding authority</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Denied today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${deniedToday > 0 ? "text-red-300" : ""}`}>{deniedToday}</p>
            <p className="text-xs text-zinc-600 mt-1">blocked actions</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Active agents</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{activeAgents}</p>
            <p className="text-xs text-zinc-600 mt-1">{agents.length} registered</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Attention queue</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {pendingCount === 0 && activeGrantCount === 0 && deniedToday === 0 && (
              <p className="text-sm text-zinc-600">No open interruptions.</p>
            )}
            {pendingCount > 0 && (
              <Link href="/dashboard/approvals" className="flex items-center justify-between rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-sm transition-colors hover:border-amber-500/35">
                <span className="text-amber-200">Human approvals</span>
                <span className="font-mono text-xs text-amber-300">{pendingCount}</span>
              </Link>
            )}
            {activeGrantCount > 0 && (
              <Link href="/dashboard/approvals" className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 text-sm transition-colors hover:border-emerald-500/35">
                <span className="text-emerald-200">Outstanding grants</span>
                <span className="font-mono text-xs text-emerald-300">{activeGrantCount}</span>
              </Link>
            )}
            {deniedToday > 0 && (
              <Link href="/dashboard/spend" className="flex items-center justify-between rounded-md border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-sm transition-colors hover:border-red-500/35">
                <span className="text-red-200">Denied actions today</span>
                <span className="font-mono text-xs text-red-300">{deniedToday}</span>
              </Link>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-zinc-300">Budget runway — today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-4">
            <BudgetMeter
              label="Agent spend"
              spentUsd={spendToday}
              capUsd={dailySpendCapUsd}
              pace={dailyPace(spendToday, dailySpendCapUsd, now)}
            />
            <BudgetMeter
              label="LLM tokens"
              spentUsd={tokenToday}
              capUsd={dailyTokenCapUsd}
              pace={dailyPace(tokenToday, dailyTokenCapUsd, now)}
              sublabel={`${((tokenDay._sum.tokensIn ?? 0) + (tokenDay._sum.tokensOut ?? 0)).toLocaleString()} tokens`}
            />
            <BudgetMeter label="Month to date" spentUsd={spendMonthTotal} capUsd={monthlyCapUsd} />
            <Link href="/dashboard/spend" className="inline-block text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline">
              Full analytics — spend, tokens, burn →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Drill-down: the same runway, seat by seat */}
      {seats.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Runway by seat</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-4 px-4 pb-4 md:grid-cols-2">
            {seats.map((seat) => (
              <Link key={seat.id} href="/dashboard/agents" className="block rounded-md px-2 py-1.5 -mx-2 transition-colors hover:bg-zinc-800/40">
                <BudgetMeter
                  label={seat.name}
                  sublabel={seat.holder ?? undefined}
                  spentUsd={seat.spentTodayUsd}
                  capUsd={seat.dailySpendCapUsd}
                  pace={dailyPace(seat.spentTodayUsd, seat.dailySpendCapUsd, now)}
                />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Agents */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-sm font-medium text-zinc-300">Agents</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {agents.length === 0 && <p className="text-zinc-600 text-sm">No agents registered yet</p>}
          <div className="space-y-2">
            {agents.map((a) => (
              <Link key={a.id} href="/dashboard/agents" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-950/60">
                <div>
                  <p className="text-zinc-300">{a.name}</p>
                  <p className="text-xs text-zinc-600 font-mono">{a.apiKeyPrefix}••••••••</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${a.isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/15 text-zinc-500 border-zinc-700"}`}>
                  {a.isActive ? "active" : "inactive"}
                </span>
              </Link>
            ))}
          </div>
          {view.isSession && (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="mb-2 text-xs text-zinc-500">Add an agent — get a scoped key + a test call:</p>
              <AgentCreator />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
