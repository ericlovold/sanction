import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  name: z.string().min(1).max(64),
})

// Per-agent budget overrides. A number sets a $ override; null clears it (back
// to inheriting the wallet policy); an omitted field is left unchanged.
const budget = z.number().min(0).max(1_000_000).nullable().optional()
const patchSchema = z.object({
  wallet_id: z.string(),
  agent_id: z.string(),
  daily_token_budget_usd: budget,
  daily_spend_budget_usd: budget,
  per_transaction_max_usd: budget,
  escalate_over_usd: budget,
  clearance: z.number().int().min(1).max(5).optional(),
  industry: z.enum(["general", "healthcare", "legal", "financial", "enterprise"]).optional(),
  clearance_expires_at: z.string().datetime().nullable().optional(),
  // Revoke (false) or reactivate (true) the agent's key. SEC-6.
  active: z.boolean().optional(),
})

// Register a new agent and return its API key (shown once).
// Management-plane: requires the wallet's management key (x-mgmt-key).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, name } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const { raw, hash, prefix } = generateApiKey()

  const agent = await db.agent.create({
    data: { walletId: wallet_id, name, apiKeyHash: hash, apiKeyPrefix: prefix },
  })

  // raw key returned once — never stored, never retrievable again
  return NextResponse.json({
    id: agent.id,
    name: agent.name,
    api_key: raw,
    api_key_prefix: prefix,
    wallet_id,
    created_at: agent.createdAt,
    warning: "Store this API key now. It will not be shown again.",
  }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const agents = await db.agent.findMany({
    where: { walletId },
    select: { id: true, name: true, apiKeyPrefix: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ agents })
}

// Set or clear per-agent budget overrides (management plane).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, agent_id, ...overrides } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const agent = await db.agent.findUnique({ where: { id: agent_id } })
  if (!agent || agent.walletId !== wallet_id) {
    return NextResponse.json({ error: "Agent not found in this wallet" }, { status: 404 })
  }

  const toCents = (n: number | null | undefined) => (n === null ? null : n === undefined ? undefined : Math.round(n * 100))
  const data = {
    dailyTokenBudgetUsd: toCents(overrides.daily_token_budget_usd),
    dailySpendBudgetUsd: toCents(overrides.daily_spend_budget_usd),
    perTransactionMaxUsd: toCents(overrides.per_transaction_max_usd),
    escalateOverUsd: toCents(overrides.escalate_over_usd),
    ...(overrides.active !== undefined ? { isActive: overrides.active } : {}),
  }

  const updated = await db.agent.update({ where: { id: agent_id }, data })

  // Clearance lives in its own row; upsert it when any clearance field is given.
  let clearance: number | undefined
  if (
    overrides.clearance !== undefined ||
    overrides.industry !== undefined ||
    overrides.clearance_expires_at !== undefined
  ) {
    const expiresAt =
      overrides.clearance_expires_at === undefined
        ? undefined
        : overrides.clearance_expires_at === null
          ? null
          : new Date(overrides.clearance_expires_at)
    const c = await db.agentClearance.upsert({
      where: { agentId: agent_id },
      update: {
        ...(overrides.clearance !== undefined ? { level: overrides.clearance } : {}),
        ...(overrides.industry !== undefined ? { industry: overrides.industry } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
      create: {
        walletId: wallet_id,
        agentId: agent_id,
        level: overrides.clearance ?? 1,
        ...(overrides.industry !== undefined ? { industry: overrides.industry } : {}),
        ...(expiresAt !== undefined && expiresAt !== null ? { expiresAt } : {}),
      },
    })
    clearance = c.level
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    active: updated.isActive,
    clearance,
    overrides: {
      daily_token_budget_usd: updated.dailyTokenBudgetUsd === null ? null : updated.dailyTokenBudgetUsd / 100,
      daily_spend_budget_usd: updated.dailySpendBudgetUsd === null ? null : updated.dailySpendBudgetUsd / 100,
      per_transaction_max_usd: updated.perTransactionMaxUsd === null ? null : updated.perTransactionMaxUsd / 100,
      escalate_over_usd: updated.escalateOverUsd === null ? null : updated.escalateOverUsd / 100,
    },
  }, { headers: { "Cache-Control": "no-store" } })
}
