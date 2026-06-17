import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { decisionCode, REMEDIATION } from "@/lib/decisions"

const schema = z.object({
  action: z.enum(["purchase", "subscribe", "transfer"]),
  amount_usd: z.number().positive(),
  merchant: z.string(),
  category: z.string(),
  description: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401 })

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

  // Stateless gates (no budget state involved)
  if (policy.blockedCategories.includes(category)) {
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: `Category '${category}' is blocked` }, agent.name)
  }
  if (amountCents > perTxnMax) {
    return persist({ ...base, status: "denied", decidedAt: new Date(), decisionNote: `Exceeds per-transaction limit of $${perTxnMax / 100}` }, agent.name)
  }

  // Stateful gate: daily-spend check + write must be atomic, otherwise two
  // concurrent requests can both pass the check and blow the cap. Serialize per
  // agent with a transaction-scoped advisory lock, then re-read inside the lock.
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

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

      if (amountCents > escalateOver) {
        return tx.authorizationRequest.create({ data: { ...base, status: "escalated" } })
      }

      return tx.authorizationRequest.create({ data: { ...base, status: "approved", decidedAt: new Date(), decisionNote: "Auto-approved by policy" } })
    })
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
