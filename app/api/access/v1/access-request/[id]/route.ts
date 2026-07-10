import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { AARP_PROBLEM, ACCESS_REQUEST_PATH, aarpProblem, aarpTaskStatus, authzenRespond as respond, publicOrigin } from "@/lib/authzen"
import { authzenRateLimit } from "@/lib/authzenRateLimit"
import { settleIfExpired } from "@/lib/approvals"
import { APPROVE_URL } from "@/lib/webhooks"

// AARP task status: the polling half of the loop. The task is the escalated
// AuthorizationRequest; its terminal states map onto the profile's —
// approved carries result.mode "reevaluate" plus the approval object (the
// one-use grant: approval.id = grant id, approved_until = grant expiry) the
// PEP presents back to the evaluation endpoint as context.approval.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return respond(req, { error }, 401)

  // Pollers loop by design — generous, but bounded (a 1s hot-poll is a bug).
  const limited = await authzenRateLimit(req, "authzen-task-poll", agent.id, 120)
  if (limited) return limited

  const row = await db.authorizationRequest.findUnique({
    where: { id },
    include: { agent: { select: { walletId: true, wallet: { select: { policy: true } } } } },
  })
  // Wallet-scoped: any of the wallet's agent keys can poll, nobody else learns
  // the task exists.
  if (!row || row.agent.walletId !== agent.walletId) {
    return aarpProblem(req, AARP_PROBLEM.unknown_task, "Unknown task", 404)
  }

  // Settle the escalation if it outlived the policy timeout, so pollers get a
  // terminal state instead of waiting forever (UX-2, same as the native poll).
  const d = await settleIfExpired(row, row.agent.wallet.policy)
  const status = aarpTaskStatus(d.status, d.decisionNote)

  const task: Record<string, unknown> = {
    id: row.id,
    status,
    status_endpoint: `${publicOrigin(req)}${ACCESS_REQUEST_PATH}/${row.id}`,
    links: { review: APPROVE_URL },
  }
  if (status === "pending") {
    const approval = await db.pendingApproval.findFirst({
      where: { sourceType: "authorization_request", sourceId: row.id },
      select: { expiresAt: true },
    })
    if (approval?.expiresAt) task.expires_at = approval.expiresAt.toISOString()
    return respond(req, { task }, 200)
  }

  if (status !== "approved") return respond(req, { task }, 200)

  // Approved: surface the grant as the AARP approval artifact, WITH its live
  // state — a consumed or revoked grant must not read as a fresh approval to
  // pollers. A timeout auto-approve mints no grant — the task reports
  // approved without a result, and a fresh evaluation will approve on its own.
  const grant = await db.grant.findFirst({
    where: { sourceType: "authorization_request", sourceId: row.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, expiresAt: true, createdAt: true },
  })
  if (!grant) return respond(req, { task }, 200)

  return respond(
    req,
    {
      task,
      result: {
        mode: "reevaluate",
        approval: {
          id: grant.id,
          status: grant.status,
          approved_at: grant.createdAt.toISOString(),
          approved_until: grant.expiresAt?.toISOString() ?? null,
        },
      },
    },
    200,
  )
}
