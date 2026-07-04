import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import {
  CAPABILITY_REMEDIATION,
  decideCapability,
  parseCapabilityRules,
  type CapabilityDecisionCode,
} from "@/lib/capability"
import { decisionEvidence } from "@/lib/evidence"
import { createCapabilityPendingApproval } from "@/lib/approvals"
import { consumeCapabilityGrant } from "@/lib/grants"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/capability")

// Capability governance (CAP-1): acquiring capability — installing a skill,
// adding a plugin, calling a new API — is authorized like a tool invocation.
// One ordered rule list (Policy.capabilityRules) with namespaced patterns;
// allowed/denied calls are decision-only, escalations persist to the same
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

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { capability, grant_id } = parsed.data
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay: only escalations persist; a re-POST with the same key
  // doubles as a status check once the owner decides.
  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(replayResponse(existing, agent.name, capability), { status: statusCode(existing.status) })
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
    return NextResponse.json(
      { authorized: false, status: "denied", code: "NO_POLICY", reason: "No policy configured", agent: agent.name, capability },
      { status: 403 },
    )
  }

  const rules = parseCapabilityRules(policy.capabilityRules)
  const decision = decideCapability({ capability, rules })

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
            decisionContextJson: decisionEvidence("capability", { capability, rules }),
            idempotencyKey,
          },
        })
        await createCapabilityPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: { id: row.id, agentId: agent.id, capability, createdAt: row.createdAt },
          policy,
          reason: decision.reason ?? "Capability requires human approval",
        })
        return row
      })

      after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            request_id: escalated.id,
            action_type: "capability.use",
            agent: agent.name,
            resource: { kind: "capability", capability },
            reason: decision.reason,
            approve_url: APPROVE_URL,
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            request_id: escalated.id, agent: agent.name, action: "use", capability, approve_url: APPROVE_URL,
          }),
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: 0, merchant: capability, category: "capability", description: decision.reason ?? null, approveUrl: APPROVE_URL,
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )

      return NextResponse.json(
        {
          authorized: false,
          status: "escalated",
          request_id: escalated.id,
          code: decision.code,
          remediation: decision.code ? CAPABILITY_REMEDIATION[decision.code] : undefined,
          reason: decision.reason,
          links: { record: `/api/v1/authorize/${escalated.id}`, evidence: `/api/v1/authorize/${escalated.id}/evidence` },
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
        if (existing) return NextResponse.json(replayResponse(existing, agent.name, capability), { status: statusCode(existing.status) })
      }
      throw e
    }
  }

  const authorized = decision.status === "allowed"
  return NextResponse.json(
    {
      authorized,
      status: decision.status,
      code: decision.code,
      remediation: decision.code ? CAPABILITY_REMEDIATION[decision.code] : undefined,
      reason: decision.reason,
      agent: agent.name,
      capability,
    },
    { status: decision.status === "denied" ? 403 : 200 },
  )
}

type Persisted = { id: string; status: string; decisionNote: string | null }

function replayResponse(r: Persisted, agentName: string, capability: string) {
  const authorized = r.status === "approved"
  const code: CapabilityDecisionCode | undefined = r.status === "escalated" ? "CAPABILITY_ESCALATION_REQUIRED" : undefined
  return {
    authorized,
    status: r.status === "approved" ? "allowed" : r.status,
    request_id: r.id,
    reason: r.decisionNote ?? undefined,
    code,
    remediation: code ? CAPABILITY_REMEDIATION[code] : undefined,
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
