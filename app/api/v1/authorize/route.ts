import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"

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

  // No policy = deny by default
  if (!policy) {
    const req_ = await db.authorizationRequest.create({
      data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "denied", decidedAt: new Date(), decisionNote: "No policy configured" },
    })
    return NextResponse.json({ authorized: false, status: "denied", reason: "No policy configured", request_id: req_.id }, { status: 403 })
  }

  const amountCents = Math.round(amount_usd * 100)

  // Blocked category
  if (policy.blockedCategories.includes(category)) {
    const req_ = await db.authorizationRequest.create({
      data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "denied", decidedAt: new Date(), decisionNote: `Category '${category}' is blocked` },
    })
    return NextResponse.json({ authorized: false, status: "denied", reason: `Category '${category}' is blocked`, request_id: req_.id }, { status: 403 })
  }

  // Over per-transaction max
  if (amountCents > policy.perTransactionMaxUsd) {
    const req_ = await db.authorizationRequest.create({
      data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "denied", decidedAt: new Date(), decisionNote: `Exceeds per-transaction limit of $${policy.perTransactionMaxUsd / 100}` },
    })
    return NextResponse.json({ authorized: false, status: "denied", reason: `Exceeds per-transaction limit of $${policy.perTransactionMaxUsd / 100}`, request_id: req_.id }, { status: 403 })
  }

  // Check daily spend
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dailySpend = await db.authorizationRequest.aggregate({
    where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
    _sum: { amountUsd: true },
  })
  const dailyTotalCents = Math.round(((dailySpend._sum.amountUsd ?? 0) + amount_usd) * 100)
  if (dailyTotalCents > policy.dailySpendBudgetUsd) {
    const req_ = await db.authorizationRequest.create({
      data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "denied", decidedAt: new Date(), decisionNote: "Daily spend budget exceeded" },
    })
    return NextResponse.json({ authorized: false, status: "denied", reason: "Daily spend budget exceeded", request_id: req_.id }, { status: 403 })
  }

  // Escalate if over threshold
  if (amountCents > policy.escalateOverUsd) {
    const req_ = await db.authorizationRequest.create({
      data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "escalated" },
    })
    return NextResponse.json({ authorized: false, status: "escalated", reason: `Amount exceeds auto-approve threshold of $${policy.escalateOverUsd / 100} — awaiting human approval`, request_id: req_.id })
  }

  // Auto-approve
  const req_ = await db.authorizationRequest.create({
    data: { agentId: agent.id, action, amountUsd: amount_usd, merchant, category, description, status: "approved", decidedAt: new Date(), decisionNote: "Auto-approved by policy" },
  })

  return NextResponse.json({
    authorized: true,
    status: "approved",
    request_id: req_.id,
    agent: agent.name,
    amount_usd,
    merchant,
  })
}
