import { after } from "next/server"
import { db } from "./db"
import { deliverEvent } from "./webhooks"

export type ApprovalDecision = "approve" | "reject"

const SOURCE_AUTHORIZATION_REQUEST = "authorization_request"
const DEFAULT_SPEND_GRANT_TTL_MINS = 15

type ApprovalClient = Pick<typeof db, "pendingApproval">
type ApprovalWorkflowClient = Pick<typeof db, "pendingApproval" | "authorizationRequest" | "grant">

type EscalationPolicy = { escalationTimeoutMins: number; escalationTimeoutAction: string } | null
type DecisionFields = { status: string; decisionNote: string | null; decidedAt: Date | null }

type SpendApprovalRequest = {
  id: string
  agentId: string
  action: string
  amountUsd: number
  merchant: string
  category: string
  description: string | null
  createdAt: Date
}

type ApprovalRecord = {
  id: string
  walletId: string
  agentId: string
  actionType: string
  status: string
  subjectJson: unknown
  resourceJson: unknown
  constraintsJson: unknown | null
  sourceType: string | null
  sourceId: string | null
  expiresAt: Date | null
  createdAt: Date
  resolvedAt?: Date | null
  resolutionNote?: string | null
  agent?: { name: string }
}

export function spendActionType(action: string) {
  return `spend.${action}`
}

export async function createSpendPendingApproval(
  client: ApprovalClient,
  input: {
    walletId: string
    agentName: string
    request: SpendApprovalRequest
    policy: Exclude<EscalationPolicy, null>
  },
) {
  const { walletId, agentName, request, policy } = input
  const expiresAt =
    policy.escalationTimeoutMins > 0
      ? new Date(request.createdAt.getTime() + policy.escalationTimeoutMins * 60_000)
      : null

  return client.pendingApproval.create({
    data: {
      walletId,
      agentId: request.agentId,
      actionType: spendActionType(request.action),
      subjectJson: { agent_id: request.agentId, agent_name: agentName },
      resourceJson: {
        kind: "spend",
        action: request.action,
        amount_usd: request.amountUsd,
        merchant: request.merchant,
        category: request.category,
        description: request.description,
      },
      constraintsJson: {
        one_use: true,
        grant_ttl_mins: DEFAULT_SPEND_GRANT_TTL_MINS,
        timeout_mins: policy.escalationTimeoutMins,
        timeout_action: policy.escalationTimeoutAction,
      },
      reason: "Exceeds escalation threshold",
      code: "ESCALATION_REQUIRED",
      sourceType: SOURCE_AUTHORIZATION_REQUEST,
      sourceId: request.id,
      expiresAt,
      createdAt: request.createdAt,
    } as never,
  })
}

// Resolving an approval = owner decision -> optional grant -> legacy spend row
// terminal state. request_id remains accepted for old API clients.
export async function resolveApproval(
  walletId: string,
  approvalOrRequestId: string,
  decision: ApprovalDecision,
  note?: string,
) {
  const approval = await db.pendingApproval.findFirst({
    where: {
      walletId,
      OR: [
        { id: approvalOrRequestId },
        { sourceType: SOURCE_AUTHORIZATION_REQUEST, sourceId: approvalOrRequestId },
      ],
    },
    include: { agent: { select: { name: true } } },
  })

  if (!approval) return resolveLegacyAuthorizationRequest(walletId, approvalOrRequestId, decision, note)

  const wasExpired = await settlePendingApprovalIfExpired(approval)
  if (wasExpired) {
    return { ok: false as const, error: "Approval expired", status: 409 as const }
  }

  if (approval.status !== "pending") {
    return { ok: false as const, error: `Approval already ${approval.status}`, status: 409 as const }
  }

  const approvalStatus = decision === "approve" ? "approved" : "denied"
  const requestStatus = decision === "approve" ? "approved" : "denied"
  const resolutionNote = note?.trim() || (decision === "approve" ? "Approved by owner" : "Rejected by owner")
  const resolvedAt = new Date()

  const result = await db.$transaction(async (tx) => {
    const client = tx as ApprovalWorkflowClient
    const updatedCount = await client.pendingApproval.updateMany({
      where: { id: approval.id, walletId, status: "pending" },
      data: { status: approvalStatus, resolvedAt, resolvedBy: "owner", resolutionNote },
    })
    if (updatedCount.count === 0) return { ok: false as const }

    const updatedApproval = await client.pendingApproval.findUnique({
      where: { id: approval.id },
      include: { agent: { select: { name: true } } },
    })
    if (!updatedApproval) return { ok: false as const }

    const grant =
      decision === "approve"
        ? await client.grant.create({
            data: {
              walletId: approval.walletId,
              agentId: approval.agentId,
              actionType: approval.actionType,
              subjectJson: approval.subjectJson,
              resourceJson: approval.resourceJson,
              constraintsJson: approval.constraintsJson,
              sourceType: approval.sourceType,
              sourceId: approval.sourceId,
              issuedBy: "owner",
              issuedFromApprovalId: approval.id,
              justification: resolutionNote,
              expiresAt: grantExpiresAt(approval.constraintsJson, resolvedAt),
            } as never,
          })
        : null

    const request =
      approval.sourceType === SOURCE_AUTHORIZATION_REQUEST && approval.sourceId
        ? await settleSourceAuthorization(client, approval.sourceId, requestStatus, resolvedAt, resolutionNote)
        : null

    return { ok: true as const, approval: updatedApproval, grant, request }
  })

  if (!result.ok) {
    return { ok: false as const, error: "Approval already resolved", status: 409 as const }
  }

  after(() =>
    Promise.all([
      deliverEvent(walletId, "approval.resolved", {
        approval_id: result.approval.id,
        grant_id: result.grant?.id,
        request_id: result.request?.id ?? approval.sourceId,
        status: result.approval.status,
        decision,
        action_type: result.approval.actionType,
        agent: result.approval.agent.name,
        resource: result.approval.resourceJson,
        note: result.approval.resolutionNote,
      }),
      deliverEvent(walletId, "escalation.resolved", {
        approval_id: result.approval.id,
        grant_id: result.grant?.id,
        request_id: result.request?.id ?? approval.sourceId,
        status: result.request?.status ?? result.approval.status,
        decision,
        agent: result.approval.agent.name,
        resource: result.approval.resourceJson,
        note: result.approval.resolutionNote,
      }),
    ]),
  )

  return { ...result, status: 200 as const }
}

async function resolveLegacyAuthorizationRequest(
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
  const rows = await db.pendingApproval.findMany({
    where: { walletId, status: "pending" },
    orderBy: { createdAt: "asc" },
    include: { agent: { select: { name: true } } },
  })

  const stillPending = []
  for (const row of rows) {
    const wasExpired = await settlePendingApprovalIfExpired(row)
    if (!wasExpired) stillPending.push(row)
  }
  return stillPending
}

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

  return settleTimedOutAuthorization(row.id, status, decidedAt, decisionNote, current)
}

async function settlePendingApprovalIfExpired(approval: ApprovalRecord) {
  if (approval.status !== "pending" || !approval.expiresAt || Date.now() <= approval.expiresAt.getTime()) {
    return false
  }

  const timeoutAction = timeoutActionFromConstraints(approval.constraintsJson)
  const requestStatus = timeoutAction === "approve" ? "approved" : "denied"
  const resolvedAt = new Date()
  const timeoutMins = timeoutMinsFromConstraints(approval.constraintsJson, approval.createdAt, approval.expiresAt)
  const resolutionNote = `Escalation timed out after ${timeoutMins}m — auto-${requestStatus} by policy`

  const result = await db.$transaction(async (tx) => {
    const client = tx as Pick<typeof db, "pendingApproval" | "authorizationRequest">
    const updated = await client.pendingApproval.updateMany({
      where: { id: approval.id, status: "pending" },
      data: { status: "expired", resolvedAt, resolvedBy: "policy_timeout", resolutionNote },
    })
    if (updated.count === 0) return false

    if (approval.sourceType === SOURCE_AUTHORIZATION_REQUEST && approval.sourceId) {
      await settleSourceAuthorization(client, approval.sourceId, requestStatus, resolvedAt, resolutionNote)
    }
    return true
  })

  return result
}

async function settleTimedOutAuthorization(
  requestId: string,
  status: string,
  decidedAt: Date,
  decisionNote: string,
  current: DecisionFields,
) {
  return db.$transaction(async (tx) => {
    const client = tx as Pick<typeof db, "pendingApproval" | "authorizationRequest">
    const res = await client.authorizationRequest.updateMany({
      where: { id: requestId, status: "escalated" },
      data: { status, decidedAt, decisionNote },
    })
    if (res.count === 0) {
      const fresh = await client.authorizationRequest.findUnique({ where: { id: requestId } })
      return fresh ? { status: fresh.status, decisionNote: fresh.decisionNote, decidedAt: fresh.decidedAt } : current
    }

    await client.pendingApproval.updateMany({
      where: { sourceType: SOURCE_AUTHORIZATION_REQUEST, sourceId: requestId, status: "pending" },
      data: { status: "expired", resolvedAt: decidedAt, resolvedBy: "policy_timeout", resolutionNote: decisionNote },
    })
    return { status, decisionNote, decidedAt }
  })
}

async function settleSourceAuthorization(
  client: Pick<typeof db, "authorizationRequest">,
  requestId: string,
  status: string,
  decidedAt: Date,
  decisionNote: string,
) {
  await client.authorizationRequest.updateMany({
    where: { id: requestId, status: "escalated" },
    data: { status, decidedAt, decisionNote },
  })
  return client.authorizationRequest.findUnique({ where: { id: requestId } })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function grantExpiresAt(constraints: unknown, now: Date) {
  const ttl = numberFromConstraints(constraints, "grant_ttl_mins") ?? DEFAULT_SPEND_GRANT_TTL_MINS
  return new Date(now.getTime() + ttl * 60_000)
}

function timeoutActionFromConstraints(constraints: unknown): "approve" | "deny" {
  return asRecord(constraints).timeout_action === "approve" ? "approve" : "deny"
}

function timeoutMinsFromConstraints(constraints: unknown, createdAt: Date, expiresAt: Date) {
  const configured = numberFromConstraints(constraints, "timeout_mins")
  if (configured !== undefined) return configured
  return Math.max(0, Math.round((expiresAt.getTime() - createdAt.getTime()) / 60_000))
}

function numberFromConstraints(constraints: unknown, key: string) {
  const value = asRecord(constraints)[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
