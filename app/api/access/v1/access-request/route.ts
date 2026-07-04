import { NextRequest } from "next/server"
import { after } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import {
  AARP_PROBLEM,
  ACCESS_REQUEST_PATH,
  AuthZenBadRequest,
  aarpProblem,
  aarpTaskStatus,
  accessRequestSchema,
  authzenRespond as respond,
  canonicalSarc,
  publicOrigin,
  sarcEquals,
  verifyBindingToken,
  type CanonicalSarc,
} from "@/lib/authzen"
import { createSpendPendingApproval, createToolPendingApproval, createProvisionPendingApproval, createCapabilityPendingApproval } from "@/lib/approvals"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { logger } from "@/lib/log"

const log = logger("access/v1/access-request")

// AARP (draft): turn a requestable denial into a real Sanction escalation.
// The PEP submits the denied subject/action/resource plus the binding token
// the evaluation endpoint signed; we verify the token proves *this* denial,
// then persist the same AuthorizationRequest + PendingApproval the native
// routes create — it lands in the owner's inbox, notifies via webhooks/email/
// Slack, and approval mints the one-use grant the PEP later redeems by
// re-evaluating with context.approval. The returned task is the handle:
// poll its status_endpoint for the terminal state.

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return respond(req, { error }, 401)
  }

  const parsed = accessRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return respond(req, { error: "Invalid request", details: parsed.error.flatten() }, 400)
  }
  const body = parsed.data

  if (body.subject.id !== agent.id && body.subject.id !== agent.name) {
    return respond(req, { error: "subject.id is not the authenticated agent" }, 403)
  }

  const policy = agent.wallet.policy
  if (!policy) return respond(req, { error: "No policy configured for this wallet" }, 400)

  // Denial binding: the token must verify, belong to this agent, and sign the
  // exact subject/action/resource being submitted.
  const verified = await verifyBindingToken(agent, body.denial.binding_token)
  if (!verified.ok) {
    return verified.expired
      ? aarpProblem(req, AARP_PROBLEM.expired_denial, "The denial has expired — re-evaluate to obtain a fresh one", 410)
      : aarpProblem(req, AARP_PROBLEM.invalid_denial_binding, "The binding token is invalid for this agent", 400)
  }
  let submitted: CanonicalSarc
  try {
    submitted = canonicalSarc(body)
  } catch (e) {
    if (e instanceof AuthZenBadRequest) return respond(req, { error: e.message }, 400)
    throw e
  }
  if (!sarcEquals(verified.sarc, submitted)) {
    return aarpProblem(
      req,
      AARP_PROBLEM.invalid_denial_binding,
      "The submitted subject/action/resource does not match the denied evaluation",
      400,
    )
  }

  const idempotencyKey = req.headers.get("idempotency-key") || undefined
  if (idempotencyKey) {
    // Replay reports the request's REAL state — a retry after the owner
    // decided must not claim "pending".
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) {
      return respond(req, taskResponse(existing.id, aarpTaskStatus(existing.status, existing.decisionNote), publicOrigin(req)), 200)
    }
  }

  const sarc = verified.sarc
  const reason = verified.reason ?? "Requires human approval"

  try {
    const escalated = await db.$transaction(async (tx) => {
      if (sarc.t === "tool") {
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            kind: "tool",
            action: "invoke",
            amountUsd: 0,
            merchant: sarc.tool,
            category: "tool",
            detailsJson: { tool: sarc.tool, server: sarc.server },
            status: "escalated",
            decisionNote: reason,
            idempotencyKey,
          },
        })
        await createToolPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: { id: row.id, agentId: agent.id, tool: sarc.tool, server: sarc.server, createdAt: row.createdAt },
          policy,
          reason,
        })
        return row
      }
      if (sarc.t === "capability") {
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            kind: "capability",
            action: "use",
            amountUsd: 0,
            merchant: sarc.capability,
            category: "capability",
            detailsJson: { capability: sarc.capability },
            status: "escalated",
            decisionNote: reason,
            idempotencyKey,
          },
        })
        await createCapabilityPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: { id: row.id, agentId: agent.id, capability: sarc.capability, createdAt: row.createdAt },
          policy,
          reason,
        })
        return row
      }
            if (sarc.t === "spend") {
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            action: sarc.action,
            amountUsd: sarc.amount_cents / 100,
            merchant: sarc.merchant,
            category: sarc.category,
            status: "escalated",
            decisionNote: reason,
            idempotencyKey,
          },
        })
        await createSpendPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: {
            id: row.id,
            agentId: agent.id,
            action: sarc.action,
            amountUsd: sarc.amount_cents / 100,
            merchant: sarc.merchant,
            category: sarc.category,
            description: null,
            createdAt: row.createdAt,
          },
          policy,
        })
        return row
      }
      const row = await tx.authorizationRequest.create({
        data: {
          agentId: agent.id,
          kind: "provision",
          action: "allocate",
          amountUsd: sarc.amount_cents / 100,
          merchant: sarc.resource,
          category: sarc.category,
          detailsJson: {
            resource: sarc.resource,
            line_item: sarc.line_item,
            quantity: sarc.quantity,
            unit_price_usd: sarc.unit_price_cents !== null ? sarc.unit_price_cents / 100 : null,
          },
          status: "escalated",
          decisionNote: reason,
          idempotencyKey,
        },
      })
      await createProvisionPendingApproval(tx, {
        walletId: agent.walletId,
        agentName: agent.name,
        request: {
          id: row.id,
          agentId: agent.id,
          amountUsd: sarc.amount_cents / 100,
          category: sarc.category,
          description: null,
          createdAt: row.createdAt,
          resource: sarc.resource,
          lineItem: sarc.line_item,
          quantity: sarc.quantity,
          unitPriceUsd: sarc.unit_price_cents !== null ? sarc.unit_price_cents / 100 : null,
        },
        policy,
        reason,
      })
      return row
    })

    // Same fan-out as a native escalation: the approval finds its human.
    const amountUsd = sarc.t === "tool" || sarc.t === "capability" ? 0 : sarc.amount_cents / 100
    const merchant = sarc.t === "tool" ? sarc.tool : sarc.t === "capability" ? sarc.capability : sarc.t === "spend" ? sarc.merchant : sarc.resource
    after(() =>
      Promise.all([
        deliverEvent(agent.walletId, "approval.created", {
          request_id: escalated.id,
          action_type: sarc.t === "tool" ? "tool.invoke" : sarc.t === "capability" ? "capability.use" : sarc.t === "spend" ? `spend.${sarc.action}` : "provision.allocate",
          agent: agent.name,
          resource: { kind: sarc.t, ...sarc },
          reason,
          approve_url: APPROVE_URL,
        }),
        deliverEvent(agent.walletId, "escalation.created", {
          request_id: escalated.id,
          agent: agent.name,
          amount_usd: amountUsd,
          merchant,
          approve_url: APPROVE_URL,
        }),
        sendEscalationEmail(agent.wallet.ownerEmail, {
          agentName: agent.name,
          amountUsd,
          merchant,
          category: sarc.t === "tool" ? "tool" : sarc.t === "capability" ? "capability" : sarc.category,
          description: reason,
          approveUrl: APPROVE_URL,
        }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
      ]),
    )

    return respond(req, taskResponse(escalated.id, "pending", publicOrigin(req)), 201)
  } catch (e: unknown) {
    if (idempotencyKey && isUniqueViolation(e)) {
      const existing = await db.authorizationRequest.findUnique({
        where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
      })
      if (existing) {
        return respond(req, taskResponse(existing.id, aarpTaskStatus(existing.status, existing.decisionNote), publicOrigin(req)), 200)
      }
    }
    throw e
  }
}

function taskResponse(id: string, status: string, origin: string) {
  return {
    task: {
      id,
      status,
      status_endpoint: `${origin}${ACCESS_REQUEST_PATH}/${id}`,
      links: { review: APPROVE_URL },
    },
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}
