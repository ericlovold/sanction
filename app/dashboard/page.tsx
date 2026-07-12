import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"

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

  // Roll up the whole subtree: a parent wallet's Overview is the org's, not just
  // its own row. A leaf wallet's subtree is itself, so this is a no-op there.
  const { ids: walletIds } = await subtreeWalletIds(walletId)
  const agents = await db.agent.findMany({ where: { walletId: { in: walletIds } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, isActive: true, apiKeyPrefix: true } })
  const agentIds = agents.map((a) => a.id)

  const [tokenDay, spendDay, spendMonth, pendingCount, activeGrantCount, deniedToday, firstAuth, firstToken] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    db.pendingApproval.count({ where: { walletId: { in: walletIds }, status: "pending" } }),
    db.grant.count({
      where: {
        walletId: { in: walletIds },
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
    db.authorizationRequest.count({ where: { agentId: { in: agentIds }, status: "denied", createdAt: { gte: dayStart } } }),
    db.authorizationRequest.findFirst({ where: { agentId: { in: agentIds } }, select: { id: true } }),
    db.tokenLog.findFirst({ where: { agentId: { in: agentIds } }, select: { id: true } }),
  ])

  return { agents, tokenDay, spendDay, spendMonth, pendingCount, activeGrantCount, deniedToday, hasActivity: !!(firstAuth || firstToken) }
}


function usd(n: number) {
  return `$${n.toFixed(4)}`
}



export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const { agents, tokenDay, spendDay, spendMonth, pendingCount, activeGrantCount, deniedToday, hasActivity } = await getStats(view.id)
  const activeAgents = agents.filter((a) => a.isActive).length

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* First-run guidance — only for a logged-in wallet with no activity yet */}
      {view.isSession && !hasActivity && (
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

      {/* Operating state */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal">Pending approvals</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${pendingCount > 0 ? "text-amber-300" : ""}`}>{pendingCount}</p>
            <p className="text-xs text-muted-foreground mt-1">human decisions</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal">Active grants</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${activeGrantCount > 0 ? "text-primary" : ""}`}>{activeGrantCount}</p>
            <p className="text-xs text-muted-foreground mt-1">outstanding authority</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal">Denied today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`text-2xl font-mono font-semibold ${deniedToday > 0 ? "text-red-300" : ""}`}>{deniedToday}</p>
            <p className="text-xs text-muted-foreground mt-1">blocked actions</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal">Active agents</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-mono font-semibold">{activeAgents}</p>
            <p className="text-xs text-muted-foreground mt-1">{agents.length} registered</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Attention queue</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {pendingCount === 0 && activeGrantCount === 0 && deniedToday === 0 && (
              <EmptyState
                title="Nothing waiting on you"
                hint="When an agent's request crosses your escalation line, it pauses here until you decide — approve it and the agent gets a single-use grant to retry with."
              />
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
                <span className="font-mono text-xs text-primary">{activeGrantCount}</span>
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

        <Card className="bg-card border-border">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usage today</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Token cost</p>
                <p className="mt-1 text-xl font-mono font-semibold">{usd(tokenDay._sum.costUsd ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{((tokenDay._sum.tokensIn ?? 0) + (tokenDay._sum.tokensOut ?? 0)).toLocaleString()} tokens</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Approved spend</p>
                <p className="mt-1 text-xl font-mono font-semibold">{usd(spendDay._sum.amountUsd ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{usd(spendMonth._sum.amountUsd ?? 0)} month</p>
              </div>
              <div className="col-span-2">
                <Link href="/dashboard/spend" className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-muted-foreground hover:underline">
                  Full analytics — spend, tokens, burn →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Agents */}
      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {agents.length === 0 && (
            <EmptyState
              title="No agents yet"
              hint="An agent is an identity you govern: it gets its own API key, budgets, and audit trail. Create your first on the Agents page — it takes under a minute."
            />
          )}
          <div className="space-y-2">
            {agents.map((a) => (
              <Link key={a.id} href="/dashboard/agents" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                <div>
                  <p className="text-muted-foreground">{a.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{a.apiKeyPrefix}••••••••</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${a.isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                  {a.isActive ? "active" : "inactive"}
                </span>
              </Link>
            ))}
          </div>
          {view.isSession && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs text-muted-foreground">Add an agent — get a scoped key + a test call:</p>
              <AgentCreator />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
