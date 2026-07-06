import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NoWallet } from "@/components/no-wallet"
import { ApprovalQueue, type PendingApproval } from "@/components/approval-queue"
import { WebhookSettings } from "@/components/webhook-settings"
import { listPendingApprovals } from "@/lib/approvals"
import { getViewWallet } from "@/lib/session"

export const metadata: Metadata = {
  title: "Sanction — Approvals",
  description: "Approve or reject governed agent actions that need human review.",
}

export const dynamic = "force-dynamic"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function actionLabel(actionType: string) {
  return actionType
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function resourceTitle(resource: Record<string, unknown>, actionType: string) {
  if (resource.kind === "spend") {
    const amount = numberValue(resource.amount_usd)
    const merchant = stringValue(resource.merchant) ?? "Unknown merchant"
    return amount === null ? merchant : `$${amount.toFixed(2)} ${merchant}`
  }
  if (resource.kind === "provision") {
    const quantity = numberValue(resource.quantity)
    const lineItem = stringValue(resource.line_item) ?? "Unknown item"
    const amount = numberValue(resource.amount_usd)
    const res = stringValue(resource.resource)
    const head = quantity === null ? lineItem : `${quantity} × ${lineItem}`
    return `${head}${amount === null ? "" : ` — $${amount.toFixed(2)}`}${res ? ` (${res})` : ""}`
  }
  return (
    stringValue(resource.label) ??
    stringValue(resource.tool_name) ??
    stringValue(resource.credential_label) ??
    stringValue(resource.name) ??
    actionLabel(actionType)
  )
}

const statusClasses: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  denied: "bg-red-500/15 text-red-400 border-red-500/20",
  expired: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
}

export default async function ApprovalsPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />
  const walletId = view.id

  const pendingRows = await listPendingApprovals(walletId)
  const pending: PendingApproval[] = pendingRows.map((r) => ({
    id: r.id,
    actionType: r.actionType,
    reason: r.reason,
    code: r.code,
    subject: asRecord(r.subjectJson),
    resource: asRecord(r.resourceJson),
    constraints: r.constraintsJson ? asRecord(r.constraintsJson) : null,
    agentName: r.agent.name,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
  }))

  // Runs after listPendingApprovals on purpose: that read settles expired
  // escalations, and the resolved list below should include them.
  const [resolved, webhooks] = await Promise.all([
    db.pendingApproval.findMany({
      where: { walletId, status: { in: ["approved", "denied", "expired"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        agent: { select: { name: true } },
        // The fold: a grant is the receipt of an approval — show it on the row.
        grants: { select: { id: true, status: true, expiresAt: true, consumedAt: true }, take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
    db.webhook.findMany({
      where: { walletId },
      select: { id: true, url: true, events: true },
      orderBy: { createdAt: "desc" },
  }),
  ])

  return (
    <div className="min-h-screen max-w-6xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-100">Authorization inbox</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Requests that crossed your escalation line, paused and waiting on you. Approving one issues a single-use grant
          the agent redeems on retry.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Pending</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`font-mono text-2xl font-semibold ${pending.length > 0 ? "text-amber-300" : ""}`}>{pending.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Recently resolved</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{resolved.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-zinc-500">Notification routes</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{webhooks.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-zinc-300">Pending</h2>
        {pending.length > 0 && (
          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/20">{pending.length}</Badge>
        )}
      </div>
      <ApprovalQueue pending={pending} editable={view.isSession} />

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-zinc-300">Resolved — issued authority</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4">
          {resolved.length === 0 && (
            <p className="text-sm text-zinc-600">
              Decisions land here with the grant they issued — the audit trail of every approval.
            </p>
          )}
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate text-zinc-300">
                    {resourceTitle(asRecord(r.resourceJson), r.actionType)} <span className="text-zinc-600">· {r.agent.name}</span>
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    {actionLabel(r.actionType)} · {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : ""}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {r.grants[0] ? (
                    <span
                      className="rounded border border-emerald-500/20 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                      title={r.grants[0].consumedAt ? "Grant consumed" : r.grants[0].expiresAt ? `Grant expires ${new Date(r.grants[0].expiresAt).toLocaleString()}` : "Grant"}
                    >
                      grant {r.grants[0].consumedAt ? "consumed" : r.grants[0].status}
                    </span>
                  ) : null}
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses[r.status] ?? statusClasses.expired}`}>{r.status}</span>
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
