import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { getViewWallet } from "@/lib/session"

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

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true, name: true, isActive: true, apiKeyPrefix: true } })
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, spendDay, spendMonth, recentAuth, recentTokens, pendingCount, activeGrantCount, deniedToday] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 8, include: { agent: { select: { name: true } } } }),
    db.tokenLog.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 8, include: { agent: { select: { name: true } } } }),
    db.pendingApproval.count({ where: { walletId, status: "pending" } }),
    db.grant.count({
      where: {
        walletId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
    db.authorizationRequest.count({ where: { agentId: { in: agentIds }, status: "denied", createdAt: { gte: dayStart } } }),
  ])

  const recentGrants = await db.grant.findMany({
    where: {
      walletId,
      sourceType: "authorization_request",
      sourceId: { in: recentAuth.map((r) => r.id) },
    },
    select: { id: true, status: true, sourceId: true, expiresAt: true, consumedAt: true },
  })
  const grantsBySource = new Map(recentGrants.map((g) => [g.sourceId, g]))

  return { agents, tokenDay, spendDay, spendMonth, recentAuth, recentTokens, pendingCount, activeGrantCount, deniedToday, grantsBySource }
}

const statusColors: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  denied: "bg-red-500/15 text-red-400 border-red-500/20",
  escalated: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
}

function usd(n: number) {
  return `$${n.toFixed(4)}`
}

function fmt(d: Date) {
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function rel(d: Date | null): string {
  if (!d) return "never"
  const diff = Date.now() - new Date(d).getTime()
  const future = diff < 0
  const min = Math.floor(Math.abs(diff) / 60000)
  const suffix = future ? "" : " ago"
  const prefix = future ? "in " : ""
  if (min < 1) return "just now"
  if (min < 60) return `${prefix}${min}m${suffix}`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${prefix}${hrs}h${suffix}`
  return `${prefix}${Math.floor(hrs / 24)}d${suffix}`
}

export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const {
    agents,
    tokenDay,
    spendDay,
    spendMonth,
    recentAuth,
    recentTokens,
    pendingCount,
    activeGrantCount,
    deniedToday,
    grantsBySource,
  } = await getStats(view.id)
  const activeAgents = agents.filter((a) => a.isActive).length

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* First-run guidance — only for a logged-in wallet with no activity yet */}
      {view.isSession && recentAuth.length === 0 && recentTokens.length === 0 && (
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
              <Link href="/dashboard/grants" className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 text-sm transition-colors hover:border-emerald-500/35">
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
            <CardTitle className="text-sm font-medium text-zinc-300">Usage today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-zinc-500">Token cost</p>
                <p className="mt-1 text-xl font-mono font-semibold">{usd(tokenDay._sum.costUsd ?? 0)}</p>
                <p className="text-xs text-zinc-600 mt-1">{((tokenDay._sum.tokensIn ?? 0) + (tokenDay._sum.tokensOut ?? 0)).toLocaleString()} tokens</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Approved spend</p>
                <p className="mt-1 text-xl font-mono font-semibold">{usd(spendDay._sum.amountUsd ?? 0)}</p>
                <p className="text-xs text-zinc-600 mt-1">{usd(spendMonth._sum.amountUsd ?? 0)} month</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Authorizations */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Authorization log</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {recentAuth.length === 0 && <p className="text-zinc-600 text-sm">No requests yet</p>}
            {recentAuth.map((r) => {
              const grant = grantsBySource.get(r.id)
              return (
                <details key={r.id} className="group rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-zinc-300">{r.merchant}</p>
                      <p className="text-xs text-zinc-600">{r.agent.name} · {fmt(r.createdAt)} · {r.action}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">{usd(r.amountUsd)}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusColors[r.status]}`}>{r.status}</span>
                    </div>
                  </summary>
                  <div className="mt-3 grid gap-2 border-t border-zinc-800 pt-3 text-xs text-zinc-500 sm:grid-cols-3">
                    <div>
                      <p className="text-zinc-600">Request</p>
                      <p className="mt-1 text-zinc-300">{r.category}</p>
                      {r.description && <p className="mt-0.5 text-zinc-500">{r.description}</p>}
                    </div>
                    <div>
                      <p className="text-zinc-600">Decision</p>
                      <p className="mt-1 text-zinc-300">{r.decisionNote ?? (r.status === "escalated" ? "Needs human approval" : "No note")}</p>
                    </div>
                    <div>
                      <p className="text-zinc-600">Grant</p>
                      {grant ? (
                        <p className="mt-1 text-zinc-300">
                          {grant.status}
                          {grant.consumedAt ? ` · consumed ${rel(grant.consumedAt)}` : grant.expiresAt ? ` · expires ${rel(grant.expiresAt)}` : ""}
                        </p>
                      ) : (
                        <p className="mt-1 text-zinc-500">none</p>
                      )}
                    </div>
                  </div>
                </details>
              )
            })}
          </CardContent>
        </Card>

        {/* Recent Token Logs */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Token log</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {recentTokens.length === 0 && <p className="text-zinc-600 text-sm">No token logs yet</p>}
            {recentTokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate text-zinc-300 font-mono text-xs">{t.model}</p>
                  <p className="text-xs text-zinc-600">{t.agent.name} · {t.taskLabel ?? "unlabeled"} · {fmt(t.createdAt)}</p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="font-mono text-xs text-zinc-400">{usd(t.costUsd)}</p>
                  <p className="text-[10px] text-zinc-600">{(t.tokensIn + t.tokensOut).toLocaleString()} tok</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

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
