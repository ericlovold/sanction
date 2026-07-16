import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { PackPicker } from "@/components/pack-picker"
import { PolicyEditor } from "@/components/policy-editor"
import { policyToDollars } from "@/lib/policy"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Policy",
  description: "Author the wallet's governance policy: budgets, categories, tools, capability rules, escalation.",
}

// The full policy surface — the 15 governed fields the decision engine reads.
// (Provision resource lists are not in policyInputSchema yet, so they're not
// editable here; that's a follow-up, not console parity v1.)
export default async function PolicyPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const [wallet, walletChildren] = await Promise.all([
    db.wallet.findUnique({ where: { id: view.id }, include: { policy: true } }),
    db.wallet.count({ where: { parentId: view.id } }),
  ])
  const agentIds = (
    await db.agent.findMany({
      where: { walletId: view.id },
      select: { id: true },
    })
  ).map((a) => a.id)
  const [tokenMonth, pendingApprovals, escalatedMonth] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    db.pendingApproval.count({ where: { walletId: view.id, status: "pending" } }),
    db.authorizationRequest.count({
      where: { agentId: { in: agentIds }, status: "escalated", createdAt: { gte: monthStart } },
    }),
  ])
  const capabilityRules = Array.isArray(wallet?.policy?.capabilityRules) ? wallet.policy.capabilityRules.length : 0

  return (
    <div className="min-h-screen max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One decision engine governs spend, tools, and capability. Everything here is checked before an agent acts,
          and every change is a replayable revision.
        </p>
      </div>

      {wallet?.policy && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card border-border">
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground">Tool posture</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {wallet.policy.blockedTools.length} blocked · {wallet.policy.escalateTools.length} escalated
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground">Capability rules</p>
              <p className="mt-1 text-sm text-muted-foreground">{capabilityRules} active rule{capabilityRules === 1 ? "" : "s"}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground">Token cost month</p>
              <p className="mt-1 font-mono text-sm text-muted-foreground">${(tokenMonth._sum.costUsd ?? 0).toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground">Approval pressure</p>
              <p className="mt-1 text-sm text-muted-foreground">{pendingApprovals} pending · {escalatedMonth} escalated</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Scope: current wallet{walletChildren > 0 ? ` (+${walletChildren} child pools managed in Pools)` : ""}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <PackPicker editable={view.isSession} />

      {wallet?.policy ? (
        <PolicyEditor policy={policyToDollars(wallet.policy)} editable={view.isSession} />
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="px-5 py-5">
            <EmptyState
              title="No policy on this wallet yet"
              hint="Until a policy exists, there are no budgets or escalation lines to enforce. The fastest start is a policy pack above — one click sets a coherent baseline, and every field stays editable afterwards."
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
