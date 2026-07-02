import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { decisionCode, decideProvisionPolicy, REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { evaluate } from "@/lib/evaluation"
import { PROVISION_STATELESS, PROVISION_STATEFUL, type ProvisionContext } from "@/lib/rules/provision"
import type { SpendContext } from "@/lib/rules/spend"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"
import { verifyExecutionJWT } from "@/lib/jwt"
import { logger } from "@/lib/log"
import { createProvisionPendingApproval } from "@/lib/approvals"
import { consumeProvisionGrant } from "@/lib/grants"
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

const log = logger("v1/authorize/provision")

// Provision authorization (MMHC pilot): "provision N seats of X for $Y" as one
// native call. The dollar side shares the spend ladder and the same daily budget
// (a provision IS spend — both kinds aggregate into the agent's approved total);
// the resource side is governed like tools (blocked/allow/escalate lists).
const schema = z.object({
  resource: z.string().min(1), // what is being provisioned, e.g. "azure.seat"
  line_item: z.string().min(1), // the concrete SKU/plan, e.g. "Microsoft 365 E3"
  quantity: z.number().int().positive(),
  unit_price_usd: z.number().positive().optional(),
  amount_usd: z.number().positive(), // total
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

  const simulate = req.nextUrl.searchParams.get("simulate") === "true"

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { resource, line_item, quantity, unit_price_usd, amount_usd, category, description, grant_id } = parsed.data
  if (simulate && grant_id) {
    return NextResponse.json({ error: "grant_id cannot be used with simulate=true" }, { status: 400 })
  }

  const amountCents = Math.round(amount_usd * 100)
  // When a unit price is supplied the math must hold — a mismatch is a malformed
  // request (agent arithmetic error), not a policy decision.
  if (unit_price_usd !== undefined && quantity * Math.round(unit_price_usd * 100) !== amountCents) {
    return NextResponse.json(
      { error: "Invalid request", code: "AMOUNT_MISMATCH", remediation: REMEDIATION.AMOUNT_MISMATCH },
      { status: 400 },
    )
  }

  const policy = agent.wallet.policy
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  if (idempotencyKey && !grant_id) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(decisionResponse(existing, agent.name), { status: statusCode(existing.status) })
  }

  // Legacy display columns: merchant holds the resource for provision rows, so
  // spend lists, daily aggregates, and audit exports render without special-casing.
  const base = {
    agentId: agent.id,
    kind: "provision",
    action: "allocate",
    amountUsd: amount_usd,
    merchant: resource,
    category,
    description,
    idempotencyKey,
    detailsJson: { resource, line_item, quantity, unit_price_usd: unit_price_usd ?? null },
  }
  const ancestorChain = await walletAncestorChain(db, agent.walletId)

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
        return consumeProvisionGrant(tx, {
          grantId: grant_id,
          walletId: agent.walletId,
          agentId: agent.id,
          request: { resource, lineItem: line_item, quantity, amountUsd: amount_usd, amountCents, category, description },
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
        deniedResponse(grantResult.code, grantResult.reason, agent.name, amount_usd, resource),
        { status: grantResult.status },
      )
    } catch (e) {
      if (e instanceof CascadeBudgetExceeded) {
        return NextResponse.json(
          deniedResponse("SUBTREE_CAP_EXCEEDED", SUBTREE_CAP_EXCEEDED_NOTE, agent.name, amount_usd, resource),
          { status: 403 },
        )
      }
      throw e
    }
  }

  if (!policy) {
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: "No policy configured" }, agent.name)
  }

  const perTxnMax = effectivePerTransactionMaxCents(agent.perTransactionMaxUsd, policy.perTransactionMaxUsd, ancestorChain)
  const dailySpendBudget = agent.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd
  const escalateOver = agent.escalateOverUsd ?? policy.escalateOverUsd

  const ctxBase: Omit<ProvisionContext, "dailySpentUsd" | "exec"> = {
    amountUsd: amount_usd,
    amountCents,
    category,
    blockedCategories: policy.blockedCategories,
    allowedCategories: policy.allowedCategories,
    perTxnMaxCents: perTxnMax,
    dailyBudgetCents: dailySpendBudget,
    autoApproveUnderCents: policy.autoApproveUnderUsd,
    escalateOverCents: escalateOver,
    escalationTimeoutMins: policy.escalationTimeoutMins,
    escalationTimeoutAction: policy.escalationTimeoutAction as "approve" | "deny",
    resource,
    blockedResources: policy.blockedResources,
    allowedResources: policy.allowedResources,
    escalateResources: policy.escalateResources,
  }

  // Stateless gates (resource, category, per-txn) run before the advisory lock.
  // The resource gate can escalate (escalateResources) — that must persist an
  // escalated request + pending approval, so it flows into the transaction below
  // via preDecision instead of short-circuiting here.
  let preDecision: ReturnType<typeof evaluate> | null = null
  if (!simulate) {
    preDecision = evaluate({ ...ctxBase, dailySpentUsd: 0 }, PROVISION_STATELESS)
    if (preDecision.effect === "deny") {
      return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: preDecision.reason }, agent.name)
    }
  }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  if (simulate) {
    const [dailySpend, cascadeExceeded] = await Promise.all([
      db.authorizationRequest.aggregate({
        where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
        _sum: { amountUsd: true },
      }),
      cascadeDailyWouldExceed(db, agent.walletId, amountCents, new Date(), ancestorChain),
    ])
    if (cascadeExceeded) return simulateResponse("denied", SUBTREE_CAP_EXCEEDED_NOTE, agent.name, amount_usd, resource)
    const { status, note } = decideProvisionPolicy({
      amountUsd: amount_usd,
      category,
      blockedCategories: policy.blockedCategories,
      allowedCategories: policy.allowedCategories,
      perTxnMaxCents: perTxnMax,
      dailySpentUsd: dailySpend._sum.amountUsd ?? 0,
      dailyBudgetCents: dailySpendBudget,
      autoApproveUnderCents: policy.autoApproveUnderUsd,
      escalateOverCents: escalateOver,
      resource,
      blockedResources: policy.blockedResources,
      allowedResources: policy.allowedResources,
      escalateResources: policy.escalateResources,
    })
    return simulateResponse(status, note, agent.name, amount_usd, resource)
  }

  try {
    // Threshold-crossing state, captured inside the transaction and notified
    // after the response (no surprises).
    let spendCrossing: { prevCents: number; nextCents: number } | null = null
    let poolCrossings: CascadeCrossing[] = []

    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`

      const escalateNow = async (reason: string) => {
        const escalated = await tx.authorizationRequest.create({ data: { ...base, status: "escalated" } })
        await createProvisionPendingApproval(tx, {
          walletId: agent.walletId,
          agentName: agent.name,
          request: {
            id: escalated.id,
            agentId: agent.id,
            amountUsd: amount_usd,
            category,
            description: description ?? null,
            createdAt: escalated.createdAt,
            resource,
            lineItem: line_item,
            quantity,
            unitPriceUsd: unit_price_usd ?? null,
          },
          policy,
          reason,
        })
        return escalated
      }

      // An escalate-listed resource requires a human regardless of amount — it
      // short-circuits before the budget gates and dollar ladder.
      if (preDecision?.effect === "escalate") {
        return escalateNow(preDecision.reason ?? "Resource requires human approval")
      }

      const dailySpend = await tx.authorizationRequest.aggregate({
        where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
        _sum: { amountUsd: true },
      })
      let exec: SpendContext["exec"]
      if (execTokenId) {
        const et = await tx.executionToken.findUnique({ where: { id: execTokenId } })
        const valid = !!et && et.status === "active" && et.expiresAt >= new Date()
        exec = { valid, spentUsd: et?.spentUsd ?? 0, budgetUsd: et?.budgetUsd ?? 0 }
      }

      const decision = evaluate({ ...ctxBase, dailySpentUsd: dailySpend._sum.amountUsd ?? 0, exec }, PROVISION_STATEFUL)

      if (decision.effect === "deny") {
        return tx.authorizationRequest.create({ data: { ...base, status: "denied", decidedAt: new Date(), decisionNote: decision.reason } })
      }
      if (decision.effect === "escalate") {
        return escalateNow(decision.reason ?? "Exceeds escalation threshold")
      }

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
        data: { ...base, status: "approved", decidedAt: new Date(), decisionNote: decision.reason },
      })
      if (execTokenId && decision.obligations.some((o) => o.type === "reserve_budget")) {
        await tx.executionToken.update({ where: { id: execTokenId }, data: { spentUsd: { increment: amount_usd } } })
      }
      return approved
    })

    if (result.status === "escalated") {
      const approval = await db.pendingApproval.findFirst({
        where: { sourceType: "authorization_request", sourceId: result.id },
        select: { id: true, actionType: true, resourceJson: true, reason: true },
      })
      const resourceSummary = `${quantity} × ${line_item} (${resource})`
      after(() =>
        Promise.all([
          deliverEvent(agent.walletId, "approval.created", {
            approval_id: approval?.id,
            request_id: result.id,
            action_type: approval?.actionType ?? "provision.allocate",
            agent: agent.name,
            resource: approval?.resourceJson ?? { kind: "provision", resource, line_item, quantity, unit_price_usd, amount_usd, category, description },
            reason: approval?.reason ?? "Exceeds escalation threshold",
            approve_url: APPROVE_URL,
          }),
          deliverEvent(agent.walletId, "escalation.created", {
            approval_id: approval?.id, request_id: result.id, agent: agent.name, action: "allocate", amount_usd, resource, line_item, quantity, category, description, approve_url: APPROVE_URL,
          }),
          sendEscalationEmail(agent.wallet.ownerEmail, {
            agentName: agent.name, amountUsd: amount_usd, merchant: resourceSummary, category, description, approveUrl: APPROVE_URL,
          }).catch((err) => log.warn("escalation email failed", { err: String(err) })),
        ]),
      )
    } else if (result.status === "denied" && (result.decisionNote === "Daily spend budget exceeded" || result.decisionNote === SUBTREE_CAP_EXCEEDED_NOTE)) {
      after(() =>
        deliverEvent(agent.walletId, "budget.exhausted", {
          agent: agent.name, scope: result.decisionNote === SUBTREE_CAP_EXCEEDED_NOTE ? "subtree_daily_spend" : "daily_spend", amount_usd, resource, category,
        }),
      )
    }

    // Early warning at the threshold line (no surprises) — see /authorize.
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
    if (idempotencyKey && isUniqueViolation(e)) {
      const existing = await db.authorizationRequest.findUnique({
        where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
      })
      if (existing) return NextResponse.json(decisionResponse(existing, agent.name), { status: statusCode(existing.status) })
    }
    throw e
  }
}

type Decision = { id: string; status: string; decisionNote: string | null; amountUsd: number; merchant: string; detailsJson?: unknown }

async function persist(data: Record<string, unknown>, agentName: string) {
  const rec = await db.authorizationRequest.create({ data: data as never })
  return NextResponse.json(decisionResponse(rec, agentName), { status: statusCode(rec.status) })
}

function decisionResponse(r: Decision, agentName: string) {
  const authorized = r.status === "approved"
  const code = decisionCode(r.status, r.decisionNote)
  const details = (r.detailsJson ?? {}) as { line_item?: string; quantity?: number; unit_price_usd?: number | null }
  return {
    authorized,
    status: r.status,
    request_id: r.id,
    reason: r.decisionNote ?? undefined,
    code,
    remediation: code ? REMEDIATION[code] : undefined,
    agent: agentName,
    amount_usd: r.amountUsd,
    resource: r.merchant,
    line_item: details.line_item,
    quantity: details.quantity,
    unit_price_usd: details.unit_price_usd ?? undefined,
  }
}

function deniedResponse(code: DecisionCode, reason: string, agentName: string, amount_usd: number, resource: string) {
  return {
    authorized: false,
    status: "denied",
    request_id: null,
    reason,
    code,
    remediation: REMEDIATION[code],
    agent: agentName,
    amount_usd,
    resource,
  }
}

function statusCode(status: string): number {
  if (status === "approved" || status === "escalated") return 200
  return 403
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}

function simulateResponse(status: string, note: string, agentName: string, amount_usd: number, resource: string) {
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
      resource,
    },
    { status: statusCode(status) },
  )
}
