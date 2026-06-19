import { after } from "next/server"
import { db } from "./db"
import { deliverEvent } from "./webhooks"

// Resolving an escalation = an owner overriding a paused charge to approved or
// denied. Shared by the REST endpoint (x-mgmt-key) and the dashboard server
// action so the two can't drift. Ownership is proven by the request's agent
// belonging to walletId — the request id alone is not authority.

export type ApprovalDecision = "approve" | "reject"

export async function resolveApproval(
  walletId: string,
  requestId: string,
  decision: ApprovalDecision,
  note?: string,
) {
  const reqRow = await db.authorizationRequest.findUnique({
    where: { id: requestId },
    include: { agent: { select: { walletId: true, name: true } } },
  })

  if (!reqRow || reqRow.agent.walletId !== walletId) {
    return { ok: false as const, error: "Request not found", status: 404 as const }
  }
  if (reqRow.status !== "escalated") {
    return { ok: false as const, error: `Request already ${reqRow.status}`, status: 409 as const }
  }

  const status = decision === "approve" ? "approved" : "denied"
  const decisionNote = note?.trim() || (decision === "approve" ? "Approved by owner" : "Rejected by owner")

  const updated = await db.authorizationRequest.update({
    where: { id: requestId },
    data: { status, decidedAt: new Date(), decisionNote },
  })

  after(() =>
    deliverEvent(walletId, "escalation.resolved", {
      request_id: updated.id, status: updated.status, decision, agent: reqRow.agent.name,
      amount_usd: updated.amountUsd, merchant: updated.merchant, note: updated.decisionNote,
    }),
  )

  return { ok: true as const, request: updated, status: 200 as const }
}

export async function listPendingApprovals(walletId: string) {
  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)
  return db.authorizationRequest.findMany({
    where: { agentId: { in: agentIds }, status: "escalated" },
    orderBy: { createdAt: "asc" },
    include: { agent: { select: { name: true } } },
  })
}
