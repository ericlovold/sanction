import { db } from "./db"

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

  return { ok: true as const, request: updated, status: 200 as const }
}

export async function listPendingApprovals(walletId: string) {
  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)
  const escalated = await db.authorizationRequest.findMany({
    where: { agentId: { in: agentIds }, status: "escalated" },
    orderBy: { createdAt: "asc" },
    include: { agent: { select: { name: true } } },
  })

  // Settle any that have passed the policy timeout, then drop them from the queue
  // (an owner shouldn't be asked to decide a request the policy already resolved).
  const policy = await db.policy.findUnique({ where: { walletId } })
  const stillPending = []
  for (const row of escalated) {
    const d = await settleIfExpired(row, policy)
    if (d.status === "escalated") stillPending.push(row)
  }
  return stillPending
}

type DecisionFields = { status: string; decisionNote: string | null; decidedAt: Date | null }
type EscalationPolicy = { escalationTimeoutMins: number; escalationTimeoutAction: string } | null

/** True once an escalated request has passed its policy timeout. 0 mins = never. */
export function escalationExpired(createdAt: Date, timeoutMins: number): boolean {
  if (timeoutMins <= 0) return false
  return Date.now() > createdAt.getTime() + timeoutMins * 60_000
}

/**
 * Settle an escalated request to its fallback terminal state once the policy
 * timeout has elapsed (UX-2). Fail-closed (deny) by default. The guarded
 * updateMany races safely against a concurrent owner decision — only one writer
 * wins; if we lose, the authoritative row is returned. Returns the decision
 * fields the caller should report.
 */
export async function settleIfExpired(
  row: { id: string; status: string; decisionNote: string | null; decidedAt: Date | null; createdAt: Date },
  policy: EscalationPolicy,
): Promise<DecisionFields> {
  const current = { status: row.status, decisionNote: row.decisionNote, decidedAt: row.decidedAt }
  if (!policy || row.status !== "escalated" || !escalationExpired(row.createdAt, policy.escalationTimeoutMins)) {
    return current
  }

  const status = policy.escalationTimeoutAction === "approve" ? "approved" : "denied"
  const decidedAt = new Date()
  const decisionNote = `Escalation timed out after ${policy.escalationTimeoutMins}m — auto-${status} by policy`

  const res = await db.authorizationRequest.updateMany({
    where: { id: row.id, status: "escalated" },
    data: { status, decidedAt, decisionNote },
  })
  if (res.count === 0) {
    // An owner resolved it in the same window — return the authoritative row.
    const fresh = await db.authorizationRequest.findUnique({ where: { id: row.id } })
    return fresh ? { status: fresh.status, decisionNote: fresh.decisionNote, decidedAt: fresh.decidedAt } : current
  }
  return { status, decisionNote, decidedAt }
}
