import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DashboardNav } from "@/components/dashboard-nav"
import { AccountControl } from "@/components/account-control"
import { ApprovalQueue, type PendingApproval } from "@/components/approval-queue"
import { WebhookSettings } from "@/components/webhook-settings"
import { listPendingApprovals } from "@/lib/approvals"
import { getViewWallet } from "@/lib/session"

export const metadata: Metadata = {
  title: "Sanction — Approvals",
  description: "Approve or reject agent charges that escalated for human review.",
}

export const dynamic = "force-dynamic"

export default async function ApprovalsPage() {
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
  const walletId = view.id

  const pendingRows = await listPendingApprovals(walletId)
  const pending: PendingApproval[] = pendingRows.map((r) => ({
    id: r.id,
    merchant: r.merchant,
    amountUsd: r.amountUsd,
    category: r.category,
    action: r.action,
    description: r.description,
    agentName: r.agent.name,
    createdAt: r.createdAt.toISOString(),
  }))

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)
  const resolved = await db.authorizationRequest.findMany({
    where: { agentId: { in: agentIds }, decisionNote: { in: ["Approved by owner", "Rejected by owner"] } },
    orderBy: { decidedAt: "desc" },
    take: 8,
    include: { agent: { select: { name: true } } },
  })

  const webhooks = await db.webhook.findMany({
    where: { walletId },
    select: { id: true, url: true, events: true },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="min-h-screen max-w-6xl mx-auto space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight hover:text-zinc-300 transition-colors">Sanction</Link>
          <p className="text-sm text-zinc-500">{view.name} · escalated charges awaiting a decision</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DashboardNav active="approvals" />
          <AccountControl view={view} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-zinc-300">Pending</h2>
        {pending.length > 0 && (
          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/20">{pending.length}</Badge>
        )}
      </div>
      <ApprovalQueue pending={pending} editable={view.isSession} />

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">Recently resolved</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4">
          {resolved.length === 0 && <p className="text-sm text-zinc-600">Nothing resolved yet</p>}
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate text-zinc-300">{r.merchant} <span className="text-zinc-600">· {r.agent.name}</span></p>
                  <p className="text-[11px] text-zinc-600">{r.decidedAt ? new Date(r.decidedAt).toLocaleString() : ""}</p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-zinc-400">${r.amountUsd.toFixed(2)}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${r.status === "approved" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-red-500/15 text-red-400 border-red-500/20"}`}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <WebhookSettings webhooks={webhooks} editable={view.isSession} />
    </div>
  )
}
