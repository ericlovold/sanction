import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { decideTool, TOOL_REMEDIATION, type ToolDecisionCode } from "@/lib/toolDecisions"
import { decisionEvidence } from "@/lib/evidence"
import { createToolPendingApproval } from "@/lib/approvals"
import { consumeToolGrant } from "@/lib/grants"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { REMEDIATION, deriveReplayCode, type DecisionCode } from "@/lib/decisions"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/tool")

// ADR-0009 M3: authorize any MCP tool invocation the same way spend is authorized.
// "Can this agent invoke this tool?" → allow / deny / escalate via the decision
// engine, against the wallet's tool block/allow/escalate lists. Allowed and denied
// calls are decision-only (tools fire at high frequency; deterministic decisions
// replay for free). An ESCALATED call persists — it becomes an AuthorizationRequest
// + PendingApproval, resolves in the same owner inbox as spend/provision, and
// approval mints a one-use tool grant the agent redeems by retrying with grant_id
// (or observes by polling /v1/authorize/{request_id}).
const schema = z.object({
  tool: z.string().min(1),
  server: z.string().optional(), // MCP server name, e.g. "github", "filesystem"
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
  const { tool, server, grant_id } = parsed.data
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay: only escalated tool calls persist, so this replays the
  // escalation — and, once the owner decides, the terminal outcome. A re-POST
  // with the same Idempotency-Key doubles as a status check.
  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(replayResponse(existing, agent.name, tool, server), { status: statusCode(existing.status) })
  }

  // Grant redemption: the owner approved this exact tool (and server) — consume
  // the one-use grant and the invocation is authorized.
  if (grant_id) {
    const result = await db.$transaction((tx) =>
      consumeToolGrant(tx, { grantId: grant_id, walletId: agent.walletId, agentId: agent.id, request: { tool, server } }),
    )
    if (result.ok) {
      return NextResponse.json(
        {
          authorized: true,
          status: "allowed",
          request_id: result.request.id,
          reason: "Grant consumed",
          agent: agent.name,
          tool,
          server,
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
        tool,
        server,
      },
      { status: result.status },
    )
  }

  const policy = agent.wallet.policy
  if (!policy) {
    return NextResponse.json(
      { authorized: false, status: "denied", code: "NO_POLICY", reason: "No policy configured", agent: agent.name, tool },
      { status: 403 },
    )
  }

  const decision = decideTool({
    tool,
    blockedTools: policy.blockedTools,
    allowedTools: policy.allowedTools,
    escalateTools: policy.escalateTools,
  })

  // Escalation persists: an audit row + an inbox item the owner can act on.
  if (decision.status === "escalated") {
    try {
      const escalated = await db.$transaction(async (tx) => {
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            kind: "tool",
            action: "invoke",
            amountUsd: 0,
            merchant: tool, // shared display/audit column, like provision's resource
            category: "tool",
            detailsJson: { tool, server: server ?? null },
            status: "escalated",
            decisionNote: decision.reason,
            // EVID-1: the tool ladder is fully stateless — the lists ARE the state.
            policyRevision: policy.currentRevision,
            decisionContextJson: decisionEvidence("tool", {
              tool,
              blockedTools: policy.blockedTools,
              allowedTools: policy.allowedTools,
              escalateTools: policy.escalateTools,
            }),
            idempotencyKey,
          },
        })
        await createToolPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: { id: row.id, agentId: agent.id, tool, server: server ?? null, createdAt: row.createdAt },
          policy,
          reason: decision.reason ?? "Tool requires human approval",
        })
        return row
      })

      after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            request_id: escalated.id,
            action_type: "tool.invoke",
            agent: agent.name,
            resource: { kind: "tool", tool, server: server ?? null },
            reason: decision.reason,
            approve_url: APPROVE_URL,
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            request_id: escalated.id, agent: agent.name, action: "invoke", tool, server: server ?? null, approve_url: APPROVE_URL,
          }),
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: 0, merchant: server ? `${tool} (${server})` : tool, category: "tool", description: decision.reason ?? null, approveUrl: APPROVE_URL,
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )

      return NextResponse.json(
        {
          authorized: false,
          status: "escalated",
          request_id: escalated.id,
          code: decision.code,
          remediation: decision.code ? TOOL_REMEDIATION[decision.code] : undefined,
          reason: decision.reason,
          agent: agent.name,
          tool,
          server,
        },
        { status: 200 },
      )
    } catch (e: unknown) {
      if (idempotencyKey && isUniqueViolation(e)) {
        const existing = await db.authorizationRequest.findUnique({
          where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
        })
        if (existing) return NextResponse.json(replayResponse(existing, agent.name, tool, server), { status: statusCode(existing.status) })
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
      remediation: decision.code ? TOOL_REMEDIATION[decision.code] : undefined,
      reason: decision.reason,
      agent: agent.name,
      tool,
      server,
    },
    { status: decision.status === "denied" ? 403 : 200 },
  )
}

type PersistedTool = { id: string; status: string; decisionNote: string | null }

function replayResponse(r: PersistedTool, agentName: string, tool: string, server?: string) {
  const { code, remediation } = deriveReplayCode(r.status, r.decisionNote, {
    code: "TOOL_ESCALATION_REQUIRED" as ToolDecisionCode,
    remediation: TOOL_REMEDIATION.TOOL_ESCALATION_REQUIRED,
  })
  return {
    authorized: r.status === "approved",
    status: r.status === "approved" ? "allowed" : r.status,
    request_id: r.id,
    reason: r.decisionNote ?? undefined,
    code,
    remediation,
    agent: agentName,
    tool,
    server,
  }
}

function statusCode(status: string): number {
  if (status === "approved" || status === "escalated") return 200
  return 403
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}
