import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NoWallet } from "@/components/no-wallet"
import { ApprovalQueue, type PendingApproval } from "@/components/approval-queue"
import { WebhookSettings } from "@/components/webhook-settings"
import { listPendingApprovals } from "@/lib/approvals"
import { getViewWallet } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { redirect } from "next/navigation"
import Link from "next/link"
import { subtreeWalletIds } from "@/lib/walletSubtree"

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
  approved: "border-emerald-600/30 bg-emerald-500/[0.07] text-emerald-700 dark:border-emerald-500/25 dark:text-emerald-400",
  denied: "border-red-600/30 bg-red-500/[0.07] text-red-700 dark:border-red-500/25 dark:text-red-400",
  expired: "border-border bg-muted text-muted-foreground",
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const { review } = await searchParams
  const view = await getViewWallet()
  // A ?review deep link is someone answering an escalation email. Neither the
  // public demo fallback nor a bare "no wallet" screen may answer that click —
  // an empty inbox reads as "already resolved" while the real decision waits
  // in another wallet. Send them to sign in, and bring them straight back.
  if (review && (!view || !view.isSession)) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/approvals?review=${review}`)}`)
  }
  if (!view) return <NoWallet />
  const walletId = view.id

  const pendingRows = await listPendingApprovals(walletId)
  const pending: PendingApproval[] = pendingRows.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
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
  const now = new Date()
  const nowMs = now.getTime()

  // Escalations waiting in the pools BELOW this wallet. The org owner can decide
  // these too (the resolve action authorizes across the subtree), so they merge
  // into one inbox below — each carrying a badge for the pool it came from.
  const { ids: subtreeIds } = await subtreeWalletIds(walletId)
  const descendantIds = subtreeIds.filter((id) => id !== walletId)

  // Runs after listPendingApprovals on purpose: that read settles expired
  // escalations, and the resolved list below should include them.
  const [resolved, webhooks, orgPendingRows] = await Promise.all([
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
    descendantIds.length
      ? db.pendingApproval.findMany({
          // Pure read — no settle pass here; expired rows are filtered, not
          // written, because settling a descendant's escalation is its owner's
          // page's job.
          where: { walletId: { in: descendantIds }, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          orderBy: { createdAt: "asc" },
          take: 50,
          include: { agent: { select: { name: true } }, wallet: { select: { name: true } } },
        })
      : [],
  ])

  // Descendant escalations, in the same shape the queue renders, tagged with the
  // pool they belong to. Merged with the wallet's own pending into one inbox and
  // sorted oldest-first — the operator clears the whole subtree from one place,
  // and the counts here match the (subtree-wide) sidebar badge.
  const orgPending: PendingApproval[] = orgPendingRows.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    actionType: r.actionType,
    reason: r.reason,
    code: r.code,
    subject: asRecord(r.subjectJson),
    resource: asRecord(r.resourceJson),
    constraints: r.constraintsJson ? asRecord(r.constraintsJson) : null,
    agentName: r.agent.name,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    poolName: r.wallet.name,
  }))
  const allPending = [...pending, ...orgPending].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  const expiringSoon = allPending.filter((p) => p.expiresAt && new Date(p.expiresAt).getTime() - nowMs <= 15 * 60 * 1000).length
  const oldestPendingMinutes = allPending.length
    ? Math.max(...allPending.map((p) => Math.round((nowMs - new Date(p.createdAt).getTime()) / 60000)))
    : 0

  // The email landing moment: resolve what the deep-linked decision is doing
  // right now, and say it plainly — waiting on you, already decided, waiting
  // on a pool below you, or not visible from this wallet.
  type Focus =
    | { kind: "pending" }
    | { kind: "resolved"; status: string; decidedAt: string | null; note: string | null; grant: string | null; title: string; agentName: string }
    | { kind: "descendant"; poolName: string; title: string; resolved: boolean }
    | { kind: "missing" }
  let focus: Focus | null = null
  if (review) {
    if (allPending.some((a) => a.id === review || a.sourceId === review)) {
      focus = { kind: "pending" }
    } else {
      const row = await db.pendingApproval.findFirst({
        where: { OR: [{ id: review }, { sourceType: "authorization_request", sourceId: review }] },
        include: {
          agent: { select: { name: true } },
          wallet: { select: { id: true, name: true } },
          grants: { select: { status: true }, take: 1, orderBy: { createdAt: "desc" } },
        },
      })
      if (!row) {
        focus = { kind: "missing" }
      } else if (row.wallet.id === walletId) {
        focus = {
          kind: "resolved",
          status: row.status,
          decidedAt: row.resolvedAt?.toLocaleString() ?? null,
          note: row.resolutionNote,
          grant: row.grants[0]?.status ?? null,
          title: resourceTitle(asRecord(row.resourceJson), row.actionType),
          agentName: row.agent.name,
        }
      } else if (descendantIds.includes(row.wallet.id)) {
        focus = {
          kind: "descendant",
          poolName: row.wallet.name,
          title: resourceTitle(asRecord(row.resourceJson), row.actionType),
          // A stale email link must not claim "waiting" for a settled decision.
          resolved: row.status !== "pending",
        }
      } else {
        focus = { kind: "missing" }
      }
    }
  }

  return (
    <div className="min-h-screen max-w-6xl mx-auto space-y-6 p-6">
      {focus && (
        <Card
          className={
            focus.kind === "pending"
              ? "border-emerald-600/40 bg-emerald-500/[0.06]"
              : "bg-card border-border"
          }
        >
          <CardContent className="px-4 py-4">
            {focus.kind === "pending" && (
              <>
                <p className="text-sm font-medium text-foreground">This decision is waiting on you.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It&apos;s highlighted below. The agent is paused mid-action: approving mints a single-use grant it
                  redeems to proceed; rejecting stops it. If you do nothing, policy settles it at the deadline.
                </p>
              </>
            )}
            {focus.kind === "resolved" && (
              <>
                <p className="text-sm font-medium text-foreground">
                  Already decided: {focus.title} · {focus.agentName} — <span className="uppercase">{focus.status}</span>
                  {focus.decidedAt ? ` at ${focus.decidedAt}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {focus.status === "approved"
                    ? focus.grant === "consumed"
                      ? "The grant it issued was redeemed — the agent completed the action."
                      : "It issued a single-use grant" + (focus.grant ? ` (currently ${focus.grant})` : "") + "."
                    : focus.status === "expired"
                      ? "No one decided in time, so policy settled it — the fail-closed default."
                      : "The agent was told no and stood down."}
                  {focus.note ? ` Note: ${focus.note}` : ""} The full record is in the Resolved list below.
                </p>
              </>
            )}
            {focus.kind === "descendant" && (
              <>
                <p className="text-sm font-medium text-foreground">
                  This decision ({focus.title}) {focus.resolved ? "was already decided in" : "is waiting in"}{" "}
                  <strong>{focus.poolName}</strong>.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {focus.resolved
                    ? "Its owner settled it — sign in with that pool's key to see the full record."
                    : 'Each pool\u2019s own owner decides — you can see it waiting under "Waiting in your pools" below, but the approve belongs to that pool\u2019s inbox. Sign in with that pool\u2019s key to decide.'}
                </p>
              </>
            )}
            {focus.kind === "missing" && (
              <>
                <p className="text-sm font-medium text-foreground">That decision isn&apos;t visible from this wallet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The email went to the owner of the wallet that raised it. {" "}
                  <Link className="underline" href={`/login?next=${encodeURIComponent(`/dashboard/approvals?review=${review}`)}`}>
                    Sign in with that wallet&apos;s key
                  </Link>{" "}
                  to land back here on the decision.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Authorization inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests that crossed an escalation line — on your wallet or any pool beneath it — paused and waiting on you.
          Approving one issues a single-use grant the agent redeems on retry.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`font-mono text-2xl font-semibold tabular-nums ${allPending.length > 0 ? "text-[oklch(0.55_0.1_85)] dark:text-[oklch(0.82_0.11_85)]" : ""}`}>{allPending.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Recently resolved</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold tabular-nums">{resolved.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Notification routes</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold tabular-nums">{webhooks.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Expiring in 15m</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={`font-mono text-2xl font-semibold tabular-nums ${expiringSoon > 0 ? "text-[oklch(0.55_0.1_85)] dark:text-[oklch(0.82_0.11_85)]" : ""}`}>{expiringSoon}</p>
            <p className="text-xs text-muted-foreground">oldest pending {oldestPendingMinutes}m</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-foreground">Pending</h2>
        {allPending.length > 0 && (
          <Badge className="bg-[oklch(0.55_0.1_85)]/10 text-[oklch(0.5_0.1_85)] dark:text-[oklch(0.82_0.11_85)] border border-[oklch(0.55_0.1_85)]/25 font-mono">{allPending.length}</Badge>
        )}
      </div>
      <ApprovalQueue pending={allPending} editable={hasRole(view.role, "admin")} focusId={review} />

      <Card className="bg-card border-border">
        <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm font-medium text-foreground">Resolved — issued authority</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4">
          {resolved.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Decisions land here with the grant they issued — the audit trail of every approval.
            </p>
          )}
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate text-foreground">
                    {resourceTitle(asRecord(r.resourceJson), r.actionType)} <span className="text-muted-foreground">· {r.agent.name}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {actionLabel(r.actionType)} · {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : ""}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {r.grants[0] ? (
                    <span
                      className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary"
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

      <WebhookSettings webhooks={webhooks} editable={hasRole(view.role, "admin")} />
    </div>
  )
}
