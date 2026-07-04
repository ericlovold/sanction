import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { decisionCode, REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { decisionEvidence } from "@/lib/evidence"
import { evaluate } from "@/lib/evaluation"
import { SPEND_STATELESS, SPEND_STATEFUL, type SpendContext } from "@/lib/rules/spend"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { verifyExecutionJWT } from "@/lib/jwt"
import { logger } from "@/lib/log"
import { createSpendPendingApproval } from "@/lib/approvals"
import { consumeSpendGrant } from "@/lib/grants"
import { notifySpendBudgetThreshold, notifyPoolCapThresholds } from "@/lib/thresholds"
import type { CascadeCrossing } from "@/lib/cascadeBudget"
import {
  CascadeBudgetExceeded,
  SUBTREE_CAP_EXCEEDED_NOTE,
  cascadeDailyWouldExceed,
  effectivePerTransactionMaxCents,
  reserveCascadeDailySpend,
  walletAncestorChain,
} from "@/lib/cascadeBudget"

const log = logger("v1/authorize")

const schema = z.object({
  action: z.enum(["purchase", "subscribe", "transfer"]),
  amount_usd: z.number().positive(),
  merchant: z.string(),
  category: z.string(),
  description: z.string().optional(),
  grant_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return NextResponse.json({ error }, { status: 401 })
  }

  // FUND-1: simulate=true runs all policy checks and returns the decision
  // without persisting anything. Lets devs validate their policy config without
  // real spend flowing. Response is identical to a live call plus { simulated: true }.
  const simulate = req.nextUrl.searchParams.get("simulate") === "true"

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { action, amount_usd, merchant, category, description, grant_id } = parsed.data
  if (simulate && grant_id) {
    return NextResponse.json({ error: "grant_id cannot be used with simulate=true" }, { status: 400 })
  }

  const policy = agent.wallet.policy
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay: a retry with the same key returns the original decision.
  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(decisionResponse(existing, agent.name), { status: statusCode(existing.status) })
  }

  const base = { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, idempotencyKey }
  const amountCents = Math.round(amount_usd * 100)
  const ancestorChain = await walletAncestorChain(db, agent.walletId)

  // Optional execution context: if the agent presents its exec JWT, this call is
  // additionally capped by that execution's hard budget (enforced in the lock).
  let execTokenId: string | null = null
  const authz = req.headers.get("authorization")
  if (authz?.startsWith("Bearer ")) {
    let claims
    try {
      claims = await verifyExecutionJWT(authz.slice(7), agent.walletId)
    } catch {
      return NextResponse.json({ error: "Invalid or expired execution token" }, { status: 401 })
    }
    if (claims.agent !== agent.id || claims.wallet !== agent.walletId) {
      return NextResponse.json({ error: "Execution token does not belong to this agent" }, { status: 403 })
    }
    execTokenId = claims.jti
  }

  if (grant_id) {
    const now = new Date()
    try {
      const grantResult = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`
        return consumeSpendGrant(tx, {
          grantId: grant_id,
          walletId: agent.walletId,
          agentId: agent.id,
          request: { action, amountUsd: amount_usd, amountCents, merchant, category, description },
          ancestorChain,
          execTokenId,
          now,
        })
      })

      if (grantResult.ok) {
        return NextResponse.json(
          {
            ...decisionResponse(grantResult.request, agent.name),
            grant_id: grantResult.grantId,
            grant_status: "consumed",
            grant_consumed_at: grantResult.consumedAt,
            grant_expires_at: grantResult.grantExpiresAt,
          },
          { status: 200 },
        )
      }

      return NextResponse.json(
        deniedResponse(grantResult.code, grantResult.reason, agent.name, amount_usd, merchant),
        { status: grantResult.status },
      )
    } catch (e) {
      if (e instanceof CascadeBudgetExceeded) {
        return NextResponse.json(
          deniedResponse("SUBTREE_CAP_EXCEEDED", SUBTREE_CAP_EXCEEDED_NOTE, agent.name, amount_usd, merchant),
          { status: 403 },
        )
      }
      throw e
    }
  }

  // No policy = deny by default
  if (!policy) {
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: "No policy configured" }, agent.name)
  }

  // Effective limits: a per-agent override wins over the wallet policy, then every
  // ancestor wallet can only tighten the per-transaction ceiling. Tree-wide daily
  // caps are separate and opt-in via Policy.subtreeDailyCapUsd below.
  const perTxnMax = effectivePerTransactionMaxCents(agent.perTransactionMaxUsd, policy.perTransactionMaxUsd, ancestorChain)
  const dailySpendBudget = agent.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd
  const escalateOver = agent.escalateOverUsd ?? policy.escalateOverUsd

  // Shared spend context for the decision engine (ADR-0009). Budget-state fields
  // (dailySpentUsd, exec) are filled per phase; everything else is stable here.
  const ctxBase: Omit<SpendContext, "dailySpentUsd" | "monthlySpentUsd" | "exec"> = {
    amountUsd: amount_usd,
    amountCents,
    category,
    blockedCategories: policy.blockedCategories,
    allowedCategories: policy.allowedCategories,
    perTxnMaxCents: perTxnMax,
    dailyBudgetCents: dailySpendBudget,
    monthlyBudgetCents: policy.monthlySpendBudgetUsd,
    autoApproveUnderCents: policy.autoApproveUnderUsd,
    escalateOverCents: escalateOver,
    escalationTimeoutMins: policy.escalationTimeoutMins,
    escalationTimeoutAction: policy.escalationTimeoutAction as "approve" | "deny",
  }

  // Stateless gates (no budget state) run before the advisory lock. The simulate
  // path uses the shared ladder (decidePolicy) below, so it need not repeat them.
  if (!simulate) {
    const gateCtx = { ...ctxBase, dailySpentUsd: 0, monthlySpentUsd: 0 }
    const gate = evaluate(gateCtx, SPEND_STATELESS)
    if (gate.effect === "deny") {
      return persist(
        {
          ...base,
          status: "denied",
          decidedAt: new Date(),
          decisionNote: gate.reason,
          policyRevision: policy.currentRevision,
          decisionContextJson: decisionEvidence("spend", gateCtx),
        },
        agent.name,
      )
    }
  }

  // Stateful gates: agent daily spend + opt-in subtree counters. The agent-local
  // check preserves existing per-agent budget behavior; subtree counters are the
  // enterprise hard stop for parent wallets that set subtreeDailyCapUsd.
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Simulation: compute the decision through the same full rule sequence, then
  // check existing ancestor counters only when the engine would approve. That
  // preserves live precedence: policy denies/escalations win before subtree caps.
  if (simulate) {
    const [dailySpend, monthlySpend] = await Promise.all([
      db.authorizationRequest.aggregate({
        where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
        _sum: { amountUsd: true },
      }),
      db.authorizationRequest.aggregate({
        where: { agentId: agent.id, status: "approved", createdAt: { gte: monthStart } },
        _sum: { amountUsd: true },
      }),
    ])

    let exec: SpendContext["exec"]
    if (execTokenId) {
      const et = await db.executionToken.findUnique({ where: { id: execTokenId } })
      const valid = !!et && et.status === "active" && et.expiresAt >= new Date()
      exec = { valid, spentUsd: et?.spentUsd ?? 0, budgetUsd: et?.budgetUsd ?? 0 }
    }

    const decision = evaluate(
      { ...ctxBase, dailySpentUsd: dailySpend._sum.amountUsd ?? 0, monthlySpentUsd: monthlySpend._sum.amountUsd ?? 0, exec },
      [...SPEND_STATELESS, ...SPEND_STATEFUL],
    )
    const status = decision.effect === "allow" ? "approved" : decision.effect === "escalate" ? "escalated" : "denied"
    const note = decision.reason ?? ""
    if (decision.effect === "allow" && (await cascadeDailyWouldExceed(db, agent.walletId, amountCents, new Date(), ancestorChain))) {
      return simulateResponse("denied", SUBTREE_CAP_EXCEEDED_NOTE, agent.name, amount_usd, merchant)
    }
    return simulateResponse(status, note, agent.name, amount_usd, merchant)
  }

  try {
    // Threshold-crossing state, captured inside the transaction (where the
    // budget reads are consistent) and notified after the response.
    let spendCrossing: { prevCents: number; nextCents: number } | null = null
    let poolCrossings: CascadeCrossing[] = []

    const result = await db.$transaction(async (tx) => {
      // Preserve the existing per-agent serialization for the agent-local daily
      // budget and execution-token debit. Ancestor counters use conditional atomic
      // writes, so sibling agents can still compete safely on shared parents.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`

      // Read budget state under the lock, then decide via the engine. The daily
      // and execution-budget gates are stateful, so they run here (not in the
      // stateless pre-check) — and before the ladder, so a sub-floor charge can
      // never bypass a hard budget.
      const [dailySpend, monthlySpend] = await Promise.all([
        tx.authorizationRequest.aggregate({
          where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
          _sum: { amountUsd: true },
        }),
        tx.authorizationRequest.aggregate({
          where: { agentId: agent.id, status: "approved", createdAt: { gte: monthStart } },
          _sum: { amountUsd: true },
        }),
      ])
      let exec: SpendContext["exec"]
      if (execTokenId) {
        const et = await tx.executionToken.findUnique({ where: { id: execTokenId } })
        const valid = !!et && et.status === "active" && et.expiresAt >= new Date()
        exec = { valid, spentUsd: et?.spentUsd ?? 0, budgetUsd: et?.budgetUsd ?? 0 }
      }

      const ctxFull = { ...ctxBase, dailySpentUsd: dailySpend._sum.amountUsd ?? 0, monthlySpentUsd: monthlySpend._sum.amountUsd ?? 0, exec }
      const decision = evaluate(ctxFull, SPEND_STATEFUL)
      // EVID-1: persist the revision in force plus the exact context evaluated,
      // so this decision can be replayed and proven later.
      const evidence = { policyRevision: policy.currentRevision, decisionContextJson: decisionEvidence("spend", ctxFull) }

      if (decision.effect === "deny") {
        return tx.authorizationRequest.create({ data: { ...base, ...evidence, status: "denied", decidedAt: new Date(), decisionNote: decision.reason } })
      }
      if (decision.effect === "escalate") {
        // No decisionNote - the response derives ESCALATION_REQUIRED from status.
        const escalated = await tx.authorizationRequest.create({ data: { ...base, ...evidence, status: "escalated" } })
        await createSpendPendingApproval(tx, { walletId: agent.walletId, agentName: agent.name, request: escalated, policy })
        return escalated
      }

      // Approved by the engine. Reserve daily spend against every capped ancestor
      // wallet — walks root→leaf with conditional atomic writes; any parent cap
      // breach throws and rolls back the whole transaction. Then honor the
      // reserve_budget obligation (exec-token debit) when there's a token to enforce
      // against — debited on every approval, including sub-floor ones.
      try {
        poolCrossings = await reserveCascadeDailySpend(tx, agent.walletId, amountCents, new Date(), ancestorChain)
      } catch (e) {
        if (e instanceof CascadeBudgetExceeded) {
          return tx.authorizationRequest.create({ data: { ...base, status: "denied", decidedAt: new Date(), decisionNote: SUBTREE_CAP_EXCEEDED_NOTE } })
        }
        throw e
      }

      const prevDailyCents = Math.round((dailySpend._sum.amountUsd ?? 0) * 100)
      spendCrossing = { prevCents: prevDailyCents, nextCents: prevDailyCents + amountCents }

      const approved = await tx.authorizationRequest.create({
        data: { ...base, ...evidence, status: "approved", decidedAt: new Date(), decisionNote: decision.reason },
      })
      if (execTokenId && decision.obligations.some((o) => o.type === "reserve_budget")) {
        await tx.executionToken.update({ where: { id: execTokenId }, data: { spentUsd: { increment: amount_usd } } })
      }
      return approved
    })

    // Notify the owner (best-effort, after the response) when a human is needed
    // or a budget tripped — the make-or-break human-in-the-loop moment.
    if (result.status === "escalated") {
      const approval = await db.pendingApproval.findFirst({
        where: { sourceType: "authorization_request", sourceId: result.id },
        select: { id: true, actionType: true, resourceJson: true, reason: true },
      })
      after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            approval_id: approval?.id,
            request_id: result.id,
            action_type: approval?.actionType ?? `spend.${action}`,
            agent: agent.name,
            resource: approval?.resourceJson ?? { kind: "spend", action, amount_usd, merchant, category, description },
            reason: approval?.reason ?? "Exceeds escalation threshold",
            approve_url: APPROVE_URL,
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            approval_id: approval?.id, request_id: result.id, agent: agent.name, action, amount_usd, merchant, category, description, approve_url: APPROVE_URL,
          }),
          // Email the owner directly, so escalations reach them even with no webhook registered.
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: amount_usd, merchant, category, description, approveUrl: APPROVE_URL,
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )
    } else if (result.status === "denied" && (result.decisionNote === "Daily spend budget exceeded" || result.decisionNote === SUBTREE_CAP_EXCEEDED_NOTE)) {
      after(() =>
        deliverEvent(agent.walletId, "budget.exhausted", {
          agent: agent.name, scope: result.decisionNote === SUBTREE_CAP_EXCEEDED_NOTE ? "subtree_daily_spend" : "daily_spend", amount_usd, merchant, category,
        }),
      )
    }

    // Early warning at the threshold line (no surprises): this approval crossed
    // 80% of the agent's daily budget and/or a pool cap — tell the owner now,
    // before anything is denied.
    if (result.status === "approved" && (spendCrossing || poolCrossings.length > 0)) {
      // TS cannot see the assignment inside the transaction callback — widen back.
      const crossing = spendCrossing as { prevCents: number; nextCents: number } | null
      after(() =>
        Promise.all([
          crossing
            ? notifySpendBudgetThreshold({
                walletId: agent.walletId,
                ownerEmail: agent.wallet.ownerEmail,
                agentName: agent.name,
                prevCents: crossing.prevCents,
                nextCents: crossing.nextCents,
                capCents: dailySpendBudget,
              })
            : Promise.resolve(),
          poolCrossings.length > 0
            ? notifyPoolCapThresholds(agent.walletId, agent.wallet.ownerEmail, poolCrossings)
            : Promise.resolve(),
        ]),
      )
    }

    return NextResponse.json(decisionResponse(result, agent.name), { status: statusCode(result.status) })
  } catch (e: unknown) {
    // Unique violation on (agentId, idempotencyKey) => concurrent duplicate; return the winner.
    if (idempotencyKey && isUniqueViolation(e)) {
      const existing = await db.authorizationRequest.findUnique({
        where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
      })
      if (existing) return NextResponse.json(decisionResponse(existing, agent.name), { status: statusCode(existing.status) })
    }
    throw e
  }
}

type Decision = { id: string; status: string; decisionNote: string | null; amountUsd: number; merchant: string }

async function persist(data: Record<string, unknown>, agentName: string) {
  const rec = await db.authorizationRequest.create({ data: data as never })
  return NextResponse.json(decisionResponse(rec, agentName), { status: statusCode(rec.status) })
}

function decisionResponse(r: Decision, agentName: string) {
  const authorized = r.status === "approved"
  const code = decisionCode(r.status, r.decisionNote)
  return {
    authorized,
    status: r.status,
    request_id: r.id,
    reason: r.decisionNote ?? undefined,
    // Machine-readable code + remediation hint so an agent can replan (UX-1).
    code,
    remediation: code ? REMEDIATION[code] : undefined,
    agent: agentName,
    amount_usd: r.amountUsd,
    merchant: r.merchant,
  }
}

function deniedResponse(code: DecisionCode, reason: string, agentName: string, amount_usd: number, merchant: string) {
  return {
    authorized: false,
    status: "denied",
    request_id: null,
    reason,
    code,
    remediation: REMEDIATION[code],
    agent: agentName,
    amount_usd,
    merchant,
  }
}

function statusCode(status: string): number {
  if (status === "approved" || status === "escalated") return 200
  return 403
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}

// FUND-1: dry-run response — same shape as a live decision, no DB write.
function simulateResponse(status: string, note: string, agentName: string, amount_usd: number, merchant: string) {
  const code = decisionCode(status, note)
  return NextResponse.json(
    {
      simulated: true,
      authorized: status === "approved",
      status,
      request_id: null,
      reason: note,
      code,
      remediation: code ? REMEDIATION[code] : undefined,
      agent: agentName,
      amount_usd,
      merchant,
    },
    { status: statusCode(status) },
  )
}
