import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

async function getStats(walletId: string) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true, name: true, isActive: true, apiKeyPrefix: true } })
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, tokenMonth, spendDay, spendMonth, recentAuth, recentTokens, pendingCount] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 8, include: { agent: { select: { name: true } } } }),
    db.tokenLog.findMany({ where: { agentId: { in: agentIds } }, orderBy: { createdAt: "desc" }, take: 8, include: { agent: { select: { name: true } } } }),
    db.authorizationRequest.count({ where: { agentId: { in: agentIds }, status: "escalated" } }),
  ])

  return { agents, tokenDay, tokenMonth, spendDay, spendMonth, recentAuth, recentTokens, pendingCount }
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

export default async function Dashboard() {
  const walletId = process.env.SANCTION_WALLET_ID
  if (!walletId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <p className="text-zinc-400 font-mono text-sm">SANCTION_WALLET_ID not set</p>
          <p className="text-zinc-600 text-xs">Create a wallet via POST /api/v1/wallets and set the ID in .env.local</p>
        </div>
      </div>
    )
  }

  const { agents, tokenDay, tokenMonth, spendDay, spendMonth, recentAuth, recentTokens, pendingCount } = await getStats(walletId)

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sanction</h1>
          <p className="text-zinc-500 text-sm">Agent wallet &amp; governance</p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/20">
            {pendingCount} pending approval{pendingCount > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Token cost today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{usd(tokenDay._sum.costUsd ?? 0)}</p>
            <p className="text-xs text-zinc-600 mt-1">{((tokenDay._sum.tokensIn ?? 0) + (tokenDay._sum.tokensOut ?? 0)).toLocaleString()} tokens</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Token cost this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{usd(tokenMonth._sum.costUsd ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Spend approved today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{usd(spendDay._sum.amountUsd ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-zinc-500 font-normal">Spend approved this month</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{usd(spendMonth._sum.amountUsd ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Authorizations */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Authorization log</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {recentAuth.length === 0 && <p className="text-zinc-600 text-sm">No requests yet</p>}
            {recentAuth.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate text-zinc-300">{r.merchant}</p>
                  <p className="text-xs text-zinc-600">{r.agent.name} · {fmt(r.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="font-mono text-xs text-zinc-400">{usd(r.amountUsd)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColors[r.status]}`}>{r.status}</span>
                </div>
              </div>
            ))}
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
          <CardTitle className="text-sm font-medium text-zinc-300">Registered agents</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {agents.length === 0 && <p className="text-zinc-600 text-sm">No agents registered yet</p>}
          <div className="space-y-2">
            {agents.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-zinc-300">{a.name}</p>
                  <p className="text-xs text-zinc-600 font-mono">{a.apiKeyPrefix}••••••••</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${a.isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/15 text-zinc-500 border-zinc-700"}`}>
                  {a.isActive ? "active" : "inactive"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
