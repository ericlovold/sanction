import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import {
  CAPABILITY_REMEDIATION,
  type CapabilityDecisionCode,
} from "@/lib/capability"
import type { Prisma } from "@/lib/generated/prisma/client"
import { decisionEvidence, isDecisionEvidence } from "@/lib/evidence"
import { recordDecision } from "@/lib/decisionMeter"
import { policyLayerChain, decideCapabilityLayered } from "@/lib/inheritance"
import { approvedViaGrant, createCapabilityPendingApproval } from "@/lib/approvals"
import { consumeCapabilityGrant } from "@/lib/grants"
import { deliverEvent, approveUrlFor } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { REMEDIATION, deriveReplayCode, type DecisionCode } from "@/lib/decisions"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/capability")

// Capability governance (CAP-1): acquiring capability — installing a skill,
// adding a plugin, calling a new API — is authorized like a tool invocation.
// One ordered rule list (Policy.capabilityRules) with namespaced patterns;
// every fresh policy decision is persisted; escalations also enter the
// approval inbox, and approval mints a one-use grant redeemed with grant_id.
const schema = z.object({
  capability: z.string().min(1).max(200), // namespaced: skill:install:x, plugin:y, api:host/path
  arguments: z.record(z.string(), z.unknown()).optional(), // advisory — not policy-evaluated or persisted
  grant_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return NextResponse.json({ error }, { status: 401 })
  }

  // KILL-1: a frozen wallet (or ancestor) pauses every data-plane action.
  const freeze = await walletFreezeState(db, agent.walletId)
  if (freeze.frozen) {
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { capability, grant_id } = parsed.data
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay must bind the key to this action, not another route or
  // capability. Approved escalations remain status-only until grant redemption.
  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return replayExisting(existing, agent.name, capability)
  }

  // Grant redemption: the owner approved this exact capability.
  if (grant_id) {
    const result = await db.$transaction((tx) =>
      consumeCapabilityGrant(tx, { grantId: grant_id, walletId: agent.walletId, agentId: agent.id, request: { capability } }),
    )
    if (result.ok) {
      return NextResponse.json(
        {
          authorized: true,
          status: "allowed",
          request_id: result.request.id,
          reason: "Grant consumed",
          agent: agent.name,
          capability,
          grant_id: result.grantId,
          grant_status: "consumed",
          grant_consumed_at: result.consumedAt,
        },
        { status: 200 },
      )
    }
    return NextResponse.json(
      {
        authorized: false,
        status: "denied",
        reason: result.reason,
        code: result.code,
        remediation: REMEDIATION[result.code as DecisionCode],
        agent: agent.name,
        capability,
      },
      { status: result.status },
    )
  }

  const policy = agent.wallet.policy
  if (!policy) {
    // No policy was evaluated: persist the refusal without invented rule evidence.
    return persistTerminalDecision({
      agentId: agent.id, kind: "capability", action: "use", amountUsd: 0,
      merchant: capability, category: "capability", detailsJson: { capability },
      status: "denied", decidedAt: new Date(), decisionNote: "No policy configured",
      idempotencyKey,
    }, agent.walletId, agent.name, capability)
  }

  // INHERIT-1: every ancestor policy is consulted — a child may tighten,
  // never loosen (see lib/inheritance.ts for the fold semantics).
  const layers = await policyLayerChain(db, { id: agent.wallet.id, parentId: agent.wallet.parentId, policy })
  const outcome = decideCapabilityLayered(capability, layers)
  const decision = {
    status: (outcome.effect === "allow" ? "allowed" : outcome.effect === "escalate" ? "escalated" : "denied") as "allowed" | "escalated" | "denied",
    code: outcome.code as import("@/lib/capability").CapabilityDecisionCode | undefined,
    reason: outcome.reason,
  }
  // Deciding layer's rules replay its verdict exactly; the trail is metadata
  // the pure rules never read.
  const evidenceCtx = {
    capability,
    rules: outcome.decidedBy.capabilityRules,
    inheritance: {
      decided_by: { wallet_id: outcome.decidedBy.walletId, revision: outcome.decidedBy.revision },
      consulted: outcome.consulted,
    },
  }

  // Escalation persists: audit row + inbox item; approval mints the grant.
  if (decision.status === "escalated") {
    try {
      const escalated = await db.$transaction(async (tx) => {
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            kind: "capability",
            action: "use",
            amountUsd: 0,
            merchant: capability, // shared display/audit column
            category: "capability",
            detailsJson: { capability },
            status: "escalated",
            decisionNote: decision.reason,
            policyRevision: policy.currentRevision,
            decisionContextJson: decisionEvidence("capability", evidenceCtx),
            idempotencyKey,
          },
        })
        const approval = await createCapabilityPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: { id: row.id, agentId: agent.id, capability, createdAt: row.createdAt },
          policy,
          reason: decision.reason ?? "Capability requires human approval",
        })
        return { row, approvalId: approval.id }
      })
      after(() => recordDecision(agent.walletId))

      after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            approval_id: escalated.approvalId,
            request_id: escalated.row.id,
            action_type: "capability.use",
            agent: agent.name,
            resource: { kind: "capability", capability },
            reason: decision.reason,
            approve_url: approveUrlFor(escalated.row.id),
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            approval_id: escalated.approvalId, request_id: escalated.row.id, agent: agent.name, action: "use", capability, approve_url: approveUrlFor(escalated.row.id),
          }),
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: 0, merchant: capability, category: "capability", description: decision.reason ?? null, approveUrl: approveUrlFor(escalated.row.id),
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )

      return NextResponse.json(
        {
          authorized: false,
          status: "escalated",
          request_id: escalated.row.id,
          created_at: escalated.row.createdAt,
          decided_at: escalated.row.decidedAt,
          code: decision.code,
          remediation: decision.code ? CAPABILITY_REMEDIATION[decision.code] : undefined,
          reason: decision.reason,
          links: { record: `/api/v1/authorize/${escalated.row.id}`, evidence: `/api/v1/authorize/${escalated.row.id}/evidence` },
          agent: agent.name,
          capability,
        },
        { status: 200 },
      )
    } catch (e: unknown) {
      if (idempotencyKey && isUniqueViolation(e)) {
        const existing = await db.authorizationRequest.findUnique({
          where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
        })
        if (existing) return replayExisting(existing, agent.name, capability)
      }
      throw e
    }
  }

  return persistTerminalDecision({
    agentId: agent.id, kind: "capability", action: "use", amountUsd: 0,
    merchant: capability, category: "capability", detailsJson: { capability },
    status: decision.status === "allowed" ? "approved" : "denied",
    decidedAt: new Date(), decisionNote: decision.reason,
    policyRevision: policy.currentRevision,
    decisionContextJson: decisionEvidence("capability", evidenceCtx),
    idempotencyKey,
  }, agent.walletId, agent.name, capability)
}

type Persisted = {
  id: string; kind: string; action: string; merchant: string; detailsJson: unknown
  status: string; decisionNote: string | null; decisionContextJson?: unknown
  createdAt: Date; decidedAt: Date | null
}

async function replayExisting(row: Persisted, agentName: string, capability: string) {
  const details = row.detailsJson as { capability?: unknown } | null
  if (row.kind !== "capability" || row.action !== "use" || row.merchant !== capability || details?.capability !== capability) {
    return NextResponse.json({
      authorized: false, status: "denied", code: "IDEMPOTENCY_CONFLICT",
      reason: "Idempotency key belongs to a different action", agent: agentName, capability,
    }, { status: 409 })
  }
  return NextResponse.json(replayResponse(row, agentName, capability, await approvedViaGrant(row)), { status: statusCode(row.status) })
}

async function persistTerminalDecision(
  data: Prisma.AuthorizationRequestUncheckedCreateInput,
  walletId: string, agentName: string, capability: string,
) {
  try {
    const row = await db.authorizationRequest.create({ data })
    after(() => recordDecision(walletId))
    return NextResponse.json(replayResponse(row, agentName, capability), { status: statusCode(row.status) })
  } catch (error) {
    if (data.idempotencyKey && isUniqueViolation(error)) {
      const existing = await db.authorizationRequest.findUnique({
        where: { agentId_idempotencyKey: { agentId: data.agentId, idempotencyKey: data.idempotencyKey } },
      })
      if (existing) return replayExisting(existing, agentName, capability)
    }
    throw error
  }
}

function replayResponse(r: Persisted, agentName: string, capability: string, grantGated = false) {
  let { code, remediation } = deriveReplayCode(r.status, r.decisionNote, {
    code: "CAPABILITY_ESCALATION_REQUIRED" as CapabilityDecisionCode,
    remediation: CAPABILITY_REMEDIATION.CAPABILITY_ESCALATION_REQUIRED,
  })
  // Fresh policy denials keep their capability-specific code on replay. Settled
  // escalations still derive timeout/owner results from the final decision note.
  const evidence = r.decisionContextJson
  if (r.status === "denied" && isDecisionEvidence(evidence) && evidence.ladder === "capability" && evidence.effect === "deny") {
    if (evidence.code === "CAPABILITY_BLOCKED" || evidence.code === "CAPABILITY_NOT_ALLOWED") {
      code = evidence.code
      remediation = CAPABILITY_REMEDIATION[evidence.code]
    }
  }
  if (grantGated) {
    // Approval minted a one-use grant; the replay is status only (see approvedViaGrant).
    return {
      authorized: false,
      status: "denied",
      approval_status: r.status,
      request_id: r.id,
      created_at: r.createdAt,
      decided_at: r.decidedAt,
      reason: "Approval status only; redeem the one-use grant to authorize an attempt",
      code,
      remediation,
      links: { record: `/api/v1/authorize/${r.id}`, evidence: `/api/v1/authorize/${r.id}/evidence` },
      agent: agentName,
      capability,
    }
  }
  return {
    authorized: r.status === "approved",
    status: r.status === "approved" ? "allowed" : r.status,
    request_id: r.id,
    created_at: r.createdAt,
    decided_at: r.decidedAt,
    reason: r.decisionNote ?? undefined,
    code,
    remediation,
    links: { record: `/api/v1/authorize/${r.id}`, evidence: `/api/v1/authorize/${r.id}/evidence` },
    agent: agentName,
    capability,
  }
}

function statusCode(status: string): number {
  if (status === "approved" || status === "escalated") return 200
  return 403
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}
