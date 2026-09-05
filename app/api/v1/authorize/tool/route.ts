import { canonicalToolRequest } from "@/lib/toolRequest"
import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { TOOL_REMEDIATION, type ToolDecisionCode } from "@/lib/toolDecisions"
import { policyLayerChain, decideToolLayered } from "@/lib/inheritance"
import { decisionEvidence } from "@/lib/evidence"
import { createToolPendingApproval } from "@/lib/approvals"
import { consumeToolGrant } from "@/lib/grants"
import { deliverEvent, approveUrlFor } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { REMEDIATION, deriveReplayCode, isObserved, type DecisionCode } from "@/lib/decisions"
import { recordDecision } from "@/lib/decisionMeter"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/tool")

// ADR-0009 M3: authorize any MCP tool invocation the same way spend is authorized.
// "Can this agent invoke this tool?" → allow / deny / escalate via the decision
// engine, against the wallet's tool block/allow/escalate lists. Allowed calls
// are decision-only (tools fire at high frequency; deterministic decisions
// replay for free). A DENIED call persists as an audit row — on a no-egress
// policy each deny IS the evidence artifact, and denies are anomalies, not
// hot-path volume. An ESCALATED call persists — it becomes an AuthorizationRequest
// + PendingApproval, resolves in the same owner inbox as spend/provision, and
// approval mints a one-use tool grant the agent redeems by retrying with grant_id
// (or observes by polling /v1/authorize/{request_id}).
const schema = z.object({
  tool: z.string().min(1),
  server: z.string().optional(), // MCP server name, e.g. "github", "filesystem"
  arguments: z.record(z.string(), z.unknown()).optional(), // encrypted for approval binding; not policy-evaluated
  input: z.record(z.string(), z.unknown()).optional(), // legacy TypeScript SDK wire alias
  grant_id: z.string().optional(),
}).refine(v => v.arguments === undefined || v.input === undefined, { message: "Send arguments or input, not both" })

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
  const { tool, server, grant_id } = parsed.data
  const args = parsed.data.arguments ?? parsed.data.input
  try { canonicalToolRequest({ tool, server, arguments: args }) } catch {
    return NextResponse.json({ error: "Invalid tool request: maximum 64 KiB and 32 nesting levels; finite JSON values required" }, { status: 400 })
  }
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay: only escalated tool calls persist, so this replays the
  // escalation — and, once the owner decides, the terminal outcome. A re-POST
  // with the same Idempotency-Key doubles as a status check.
  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(replayResponse(existing, agent.name, tool, server), { status: httpFor(existing) })
  }

  // Grant redemption: the owner approved this tool, server, and arguments — consume
  // the one-use grant and the invocation is authorized.
  if (grant_id) {
    const result = await db.$transaction((tx) =>
      consumeToolGrant(tx, { grantId: grant_id, walletId: agent.walletId, agentId: agent.id, request: { tool, server, arguments: args } }),
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
    // MONO-0: deny-by-default is still a rendered decision.
    after(() => recordDecision(agent.walletId))
    return NextResponse.json(
      { authorized: false, status: "denied", code: "NO_POLICY", reason: "No policy configured", agent: agent.name, tool },
      { status: 403 },
    )
  }

  // OBS-1: observe mode — identical ladder, truthful persisted status with an
  // observed marker, nothing blocked, no approvals or pages (see spend route).
  const observe = policy.enforcementMode === "observe"

  // INHERIT-1: the decision spans every ancestor policy — a child may
  // tighten, never loosen. Leaf layer comes from the wallet already in hand;
  // a parentless wallet adds zero queries and folds to exactly the old path.
  const layers = await policyLayerChain(db, { id: agent.wallet.id, parentId: agent.wallet.parentId, policy })
  // COND-1: signals captured ONCE here — rules never read the live clock or
  // counters, so the persisted context replays byte-for-byte. The call count
  // is only fetched when some layer actually conditions on it.
  const needsCallCount = layers.some((l) => l.toolConditions.some((r) => r.when.after_model_calls_today !== undefined))
  const signalDayStart = new Date()
  signalDayStart.setHours(0, 0, 0, 0)
  const signals = {
    requestHourUtc: new Date().getUTCHours(),
    modelCallsToday: needsCallCount
      ? await db.tokenLog.count({ where: { agentId: agent.id, createdAt: { gte: signalDayStart } } })
      : undefined,
  }
  const outcome = decideToolLayered(tool, layers, signals)
  const decision = {
    status: (outcome.effect === "allow" ? "allowed" : outcome.effect === "escalate" ? "escalated" : "denied") as "allowed" | "escalated" | "denied",
    code: outcome.code as ToolDecisionCode | undefined,
    reason: outcome.reason,
  }
  // Evidence context: the DECIDING layer's lists (replay reproduces its
  // verdict exactly) plus the consulted-revision trail. Extra keys are
  // invisible to the pure rules, so old and new rows replay identically.
  const evidenceCtx = {
    tool,
    blockedTools: outcome.decidedBy.blockedTools,
    allowedTools: outcome.decidedBy.allowedTools,
    escalateTools: outcome.decidedBy.escalateTools,
    conditions: outcome.decidedBy.toolConditions,
    requestHourUtc: signals.requestHourUtc,
    modelCallsToday: signals.modelCallsToday,
    inheritance: {
      decided_by: { wallet_id: outcome.decidedBy.walletId, revision: outcome.decidedBy.revision },
      consulted: outcome.consulted,
    },
  }

  // Escalation persists: an audit row + an inbox item the owner can act on.
  if (decision.status === "escalated") {
    try {
      const escalated = await db.$transaction(async (tx) => {
        let approvalId: string | null = null
        const row = await tx.authorizationRequest.create({
          data: {
            agentId: agent.id,
            kind: "tool",
            action: "invoke",
            amountUsd: 0,
            merchant: tool, // shared display/audit column, like provision's resource
            category: "tool",
            detailsJson: { tool, server: server ?? null, ...(observe ? { observed: true } : {}) },
            status: "escalated",
            decisionNote: decision.reason,
            // EVID-1: the tool ladder is fully stateless — the lists ARE the state.
            policyRevision: policy.currentRevision,
            decisionContextJson: decisionEvidence("tool", evidenceCtx),
            idempotencyKey,
          },
        })
        // Observed escalations log; they never page anyone (OBS-1).
        if (!observe) {
          const approval = await createToolPendingApproval(tx, {
            walletId: agent.walletId,
            agentName: agent.name,
            request: { id: row.id, agentId: agent.id, tool, server: server ?? null, arguments: args, createdAt: row.createdAt },
            policy,
            reason: decision.reason ?? "Tool requires human approval",
          })
          approvalId = approval.id
        }
        return { row, approvalId }
      })
      after(() => recordDecision(agent.walletId))

      if (!observe) after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            approval_id: escalated.approvalId ?? undefined,
            request_id: escalated.row.id,
            action_type: "tool.invoke",
            agent: agent.name,
            resource: { kind: "tool", tool, server: server ?? null },
            reason: decision.reason,
            approve_url: approveUrlFor(escalated.row.id),
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            approval_id: escalated.approvalId ?? undefined, request_id: escalated.row.id, agent: agent.name, action: "invoke", tool, server: server ?? null, approve_url: approveUrlFor(escalated.row.id),
          }),
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: 0, merchant: server ? `${tool} (${server})` : tool, category: "tool", description: decision.reason ?? null, approveUrl: approveUrlFor(escalated.row.id),
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )

      if (observe) {
        return NextResponse.json(
          {
            authorized: true,
            status: "allowed",
            mode: "observe",
            would_be: {
              status: "escalated",
              code: decision.code,
              remediation: decision.code ? TOOL_REMEDIATION[decision.code] : undefined,
              reason: decision.reason,
            },
            request_id: escalated.row.id,
            agent: agent.name,
            tool,
            server,
          },
          { status: 200 },
        )
      }
      return NextResponse.json(
        {
          authorized: false,
          status: "escalated",
          request_id: escalated.row.id,
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
        if (existing) return NextResponse.json(replayResponse(existing, agent.name, tool, server), { status: httpFor(existing) })
      }
      throw e
    }
  }

  // Denial persists as an audit row (no inbox item — nothing to approve).
  let requestId: string | undefined
  if (decision.status === "denied") {
    try {
      const denied = await db.authorizationRequest.create({
        data: {
          agentId: agent.id,
          kind: "tool",
          action: "invoke",
          amountUsd: 0,
          merchant: tool,
          category: "tool",
          detailsJson: { tool, server: server ?? null, ...(observe ? { observed: true } : {}) },
          status: "denied",
          decidedAt: new Date(),
          decisionNote: decision.reason,
          policyRevision: policy.currentRevision,
          decisionContextJson: decisionEvidence("tool", evidenceCtx),
          idempotencyKey,
        },
      })
      requestId = denied.id
      after(() => recordDecision(agent.walletId))
    } catch (e: unknown) {
      if (idempotencyKey && isUniqueViolation(e)) {
        const existing = await db.authorizationRequest.findUnique({
          where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
        })
        if (existing) return NextResponse.json(replayResponse(existing, agent.name, tool, server), { status: httpFor(existing) })
      }
      throw e
    }
  }

  if (observe && decision.status !== "allowed") {
    return NextResponse.json(
      {
        authorized: true,
        status: "allowed",
        mode: "observe",
        would_be: {
          status: decision.status,
          code: decision.code,
          remediation: decision.code ? TOOL_REMEDIATION[decision.code] : undefined,
          reason: decision.reason,
        },
        request_id: requestId,
        agent: agent.name,
        tool,
        server,
      },
      { status: 200 },
    )
  }
  // MONO-0: allowed tool calls are decision-only (never persisted) — the
  // meter is the one place they count.
  if (decision.status === "allowed") after(() => recordDecision(agent.walletId))
  const authorized = decision.status === "allowed"
  return NextResponse.json(
    {
      authorized,
      status: decision.status,
      request_id: requestId,
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

type PersistedTool = { id: string; status: string; decisionNote: string | null; detailsJson?: unknown }

// Observed rows always answer 200 — the truthful status lives in would_be.
function httpFor(r: PersistedTool): number {
  return isObserved(r) ? 200 : statusCode(r.status)
}

function replayResponse(r: PersistedTool, agentName: string, tool: string, server?: string) {
  const { code, remediation } = deriveReplayCode(r.status, r.decisionNote, {
    code: "TOOL_ESCALATION_REQUIRED" as ToolDecisionCode,
    remediation: TOOL_REMEDIATION.TOOL_ESCALATION_REQUIRED,
  })
  if (isObserved(r)) {
    // Historical observation is status only, including after a switch to enforce.
    return {
      authorized: false,
      status: "denied",
      approval_status: r.status,
      reason: "Historical observation only; submit a fresh request for authorization",
      mode: "observe",
      would_be: { status: r.status, reason: r.decisionNote ?? undefined, code, remediation },
      request_id: r.id,
      agent: agentName,
      tool,
      server,
    }
  }
  return {
    authorized: false,
    status: r.status === "approved" ? "denied" : r.status,
    approval_status: r.status,
    request_id: r.id,
    reason: r.status === "approved" ? "Approval status only; redeem the one-use grant to authorize an attempt" : r.decisionNote ?? undefined,
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
