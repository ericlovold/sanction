import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { PackPicker } from "@/components/pack-picker"
import { PolicyEditor } from "@/components/policy-editor"
import { policyToDollars } from "@/lib/policy"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd } from "@/lib/format"
import { hasRole } from "@/lib/roles"
import { policyLayerChain } from "@/lib/inheritance"

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
  const now = new Date()
  // The editor below is wallet-local (it edits THIS wallet's policy), but the
  // activity cards measure the org like every other surface: subtree-wide, so
  // they agree with Overview instead of reading $0.00 at an HQ whose agents
  // all live in pools.
  const { ids: subtreeIds } = await subtreeWalletIds(view.id)
  const wallet = await db.wallet.findUnique({ where: { id: view.id }, include: { policy: true } })
  const agentIds = (
    await db.agent.findMany({
      where: { walletId: { in: subtreeIds } },
      select: { id: true },
    })
  ).map((a) => a.id)
  const [tokenMonth, pendingApprovals, escalatedMonth] = await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    // Live pending, like the sidebar badge: an expired escalation is no longer
    // actionable, so it doesn't count as pressure.
    db.pendingApproval.count({
      where: { walletId: { in: subtreeIds }, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    db.authorizationRequest.count({
      where: { agentId: { in: agentIds }, status: "escalated", createdAt: { gte: monthStart } },
    }),
  ])
  const capabilityRules = Array.isArray(wallet?.policy?.capabilityRules) ? wallet.policy.capabilityRules.length : 0

  // INHERIT-1: rules inherited from ancestor wallets bind this wallet's agents
  // and are not editable here — they are shown so a denial that names a parent
  // reads as governance, not as a bug. Ancestors only (own policy is the editor).
  const ancestorLayers = wallet?.policy
    ? (
        await policyLayerChain(db, { id: wallet.id, parentId: wallet.parentId, policy: wallet.policy })
      ).slice(0, -1)
    : []
  // Zero-noise: an ancestor with nothing to say adds nothing here — the chain
  // is still consulted at decision time either way.
  const inheritedLayers = ancestorLayers.filter(
    (l) => l.blockedTools.length > 0 || l.escalateTools.length > 0 || l.allowedTools.length > 0 || l.capabilityRules.length > 0,
  )
  const layerNames = new Map(
    inheritedLayers.length > 0
      ? (
          await db.wallet.findMany({ where: { id: { in: inheritedLayers.map((l) => l.walletId) } }, select: { id: true, name: true } })
        ).map((w) => [w.id, w.name] as const)
      : [],
  )

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
              <p className="mt-1 font-mono text-sm text-muted-foreground">{fmtUsd(tokenMonth._sum.costUsd ?? 0)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground">Approval pressure</p>
              <p className="mt-1 text-sm text-muted-foreground">{pendingApprovals} pending · {escalatedMonth} escalated</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Inherited constraints — read-only by design; edited on the parent. */}
      {inheritedLayers.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="px-5 py-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Inherited from parent wallets</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                These rules bind every agent in this wallet and cannot be loosened here — a parent&apos;s block or
                escalate always stands. Edit them on the wallet that owns them.
              </p>
            </div>
            {inheritedLayers.map((l) => {
              const caps = l.capabilityRules.length
              const parts = [
                l.blockedTools.length > 0 && `blocks ${l.blockedTools.join(", ")}`,
                l.escalateTools.length > 0 && `escalates ${l.escalateTools.join(", ")}`,
                l.allowedTools.length > 0 && `allow-list of ${l.allowedTools.length} tool${l.allowedTools.length === 1 ? "" : "s"}`,
                caps > 0 && `${caps} capability rule${caps === 1 ? "" : "s"}`,
              ].filter(Boolean)
              return (
                <div key={l.walletId} className="flex items-start justify-between gap-3 border-t border-border pt-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{layerNames.get(l.walletId) ?? l.walletId}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{parts.join(" · ")}</p>
                  </div>
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    rev {l.revision} · inherited
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <PackPicker editable={hasRole(view.role, "admin")} previewable={view.isSession} />

      {wallet?.policy ? (
        <PolicyEditor
          policy={policyToDollars(wallet.policy)}
          editable={hasRole(view.role, "admin")}
          readOnlyNote={
            view.isSession
              ? "Your role can view this policy but not change it — ask the wallet owner for admin access."
              : undefined
          }
        />
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
