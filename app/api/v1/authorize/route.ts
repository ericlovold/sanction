import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { decisionCode, REMEDIATION } from "@/lib/decisions"
import { deliverEvent, APPROVE_URL } from "@/lib/webhooks"
import { verifyExecutionJWT } from "@/lib/jwt"
import { logger } from "@/lib/log"

const log = logger("v1/authorize")

const schema = z.object({
  action: z.enum(["purchase", "subscribe", "transfer"]),
  amount_usd: z.number().positive(),
  merchant: z.string(),
  category: z.string(),
  description: z.string().optional(),
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

  const { action, amount_usd, merchant, category, description } = parsed.data
  const policy = agent.wallet.policy
  const idempotencyKey = req.headers.get("idempotency-key") || undefined

  // Idempotent replay: a retry with the same key returns the original decision.
  if (idempotencyKey) {
    const existing = await db.authorizationRequest.findUnique({
      where: { agentId_idempotencyKey: { agentId: agent.id, idempotencyKey } },
    })
    if (existing) return NextResponse.json(decisionResponse(existing, agent.name), { status: statusCode(existing.status) })
  }

  const base = { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, idempotencyKey }

  // No policy = deny by default
  if (!policy) {
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: "No policy configured" }, agent.name)
  }

  const amountCents = Math.round(amount_usd * 100)

  // Effective limits: a per-agent override wins over the wallet policy; null inherits.
  const perTxnMax = agent.perTransactionMaxUsd ?? policy.perTransactionMaxUsd
  const dailySpendBudget = agent.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd
  const escalateOver = agent.escalateOverUsd ?? policy.escalateOverUsd

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

  // Stateless gates (no budget state involved)
  if (policy.blockedCategories.includes(category)) {
    const note = `Category '${category}' is blocked`
    if (simulate) return simulateResponse("denied", note, agent.name, amount_usd, merchant)
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: note }, agent.name)
  }
  if (amountCents > perTxnMax) {
    const note = `Exceeds per-transaction limit of $${perTxnMax / 100}`
    if (simulate) return simulateResponse("denied", note, agent.name, amount_usd, merchant)
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: note }, agent.name)
  }

  // Stateful gate: daily-spend check + write must be atomic, otherwise two
  // concurrent requests can both pass the check and blow the cap. Serialize per
  // agent with a transaction-scoped advisory lock, then re-read inside the lock.
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  // Simulation: read current daily spend and compute the decision without locking or writing.
  if (simulate) {
    const dailySpend = await db.authorizationRequest.aggregate({
      where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
      _sum: { amountUsd: true },
    })
    const dailyTotalCents = Math.round(((dailySpend._sum.amountUsd ?? 0) + amount_usd) * 100)
    if (dailyTotalCents > dailySpendBudget) return simulateResponse("denied", "Daily spend budget exceeded", agent.name, amount_usd, merchant)
    if (amountCents > escalateOver) return simulateResponse("escalated", "Exceeds escalation threshold", agent.name, amount_usd, merchant)
    return simulateResponse("approved", "Auto-approved by policy", agent.name, amount_usd, merchant)
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`

      const dailySpend = await tx.authorizationRequest.aggregate({
        where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
        _sum: { amountUsd: true },
      })
      const dailyTotalCents = Math.round(((dailySpend._sum.amountUsd ?? 0) + amount_usd) * 100)
      if (dailyTotalCents > dailySpendBudget) {
        return tx.authorizationRequest.create({ data: { ...base, status: "denied", decidedAt: new Date(), decisionNote: "Daily spend budget exceeded" } })
      }

      // Execution-scoped hard cap (re-read under the lock for atomicity).
      if (execTokenId) {
        const et = await tx.executionToken.findUnique({ where: { id: execTokenId } })
        if (!et || et.status !== "active" || et.expiresAt < new Date()) {
          return tx.authorizationRequest.create({ data: { ...base, status: "denied", decidedAt: new Date(), decisionNote: "Execution token expired or revoked" } })
        }
        if (Math.round((et.spentUsd + amount_usd) * 100) > Math.round(et.budgetUsd * 100)) {
          return tx.authorizationRequest.create({ data: { ...base, status: "denied", decidedAt: new Date(), decisionNote: "Execution budget exceeded" } })
        }
      }

      if (amountCents > escalateOver) {
        return tx.authorizationRequest.create({ data: { ...base, status: "escalated" } })
      }

      const approved = await tx.authorizationRequest.create({ data: { ...base, status: "approved", decidedAt: new Date(), decisionNote: "Auto-approved by policy" } })
      // Debit the execution budget only on actual (auto-)approval.
      if (execTokenId) {
        await tx.executionToken.update({ where: { id: execTokenId }, data: { spentUsd: { increment: amount_usd } } })
      }
      return approved
    })

    // Notify the owner (best-effort, after the response) when a human is needed
    // or a budget tripped — the make-or-break human-in-the-loop moment.
    if (result.status === "escalated") {
      after(() =>
        deliverEvent(agent.walletId, "escalation.created", {
          request_id: result.id, agent: agent.name, action, amount_usd, merchant, category, description, approve_url: APPROVE_URL,
        }),
      )
    } else if (result.status === "denied" && result.decisionNote === "Daily spend budget exceeded") {
      after(() =>
        deliverEvent(agent.walletId, "budget.exhausted", {
          agent: agent.name, scope: "daily_spend", amount_usd, merchant, category,
        }),
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
