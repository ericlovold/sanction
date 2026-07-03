import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { authenticateOwner } from "@/lib/ownerAuth"

// Seat wallets: stamp one template across N seats in a single call — "five
// engineering seats, $20/day each, expiring end of quarter." Management-plane.
// Each seat gets its own key (shown once, only hashes stored); budgets,
// clearance, and expiry come from the template. Cap keeps a typo from minting
// 5,000 keys.
const MAX_SEATS = 50

const budget = z.number().min(0).max(1_000_000).optional()
const schema = z.object({
  wallet_id: z.string(),
  // Either explicit seat names/holders, or a prefix + count ("eng" → eng-1..eng-5).
  seats: z
    .array(z.object({ name: z.string().min(1).max(64), holder: z.string().min(1).max(120).optional() }))
    .min(1)
    .max(MAX_SEATS)
    .optional(),
  name_prefix: z.string().min(1).max(48).optional(),
  count: z.number().int().min(1).max(MAX_SEATS).optional(),
  template: z
    .object({
      daily_token_budget_usd: budget,
      daily_spend_budget_usd: budget,
      per_transaction_max_usd: budget,
      escalate_over_usd: budget,
      clearance: z.number().int().min(1).max(5).optional(),
      industry: z.enum(["general", "healthcare", "legal", "financial", "enterprise"]).optional(),
      expires_at: z.string().datetime().optional(),
    })
    .default({}),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, seats, name_prefix, count, template } = parsed.data

  const roster =
    seats ??
    (name_prefix && count
      ? Array.from({ length: count }, (_, i) => ({ name: `${name_prefix}-${i + 1}`, holder: undefined as string | undefined }))
      : null)
  if (!roster) {
    return NextResponse.json({ error: "Provide seats[], or name_prefix + count" }, { status: 400 })
  }
  if (roster.length > MAX_SEATS) {
    return NextResponse.json({ error: `At most ${MAX_SEATS} seats per call` }, { status: 400 })
  }

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const toCents = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 100))
  const expiresAt = template.expires_at ? new Date(template.expires_at) : undefined

  // Keys are generated up front; the transaction creates all seats or none.
  const minted = roster.map((seat) => ({ seat, key: generateApiKey() }))
  const created = await db.$transaction(async (tx) => {
    const rows = []
    for (const { seat, key } of minted) {
      const agent = await tx.agent.create({
        data: {
          walletId: wallet_id,
          name: seat.name,
          holder: seat.holder,
          apiKeyHash: key.hash,
          apiKeyPrefix: key.prefix,
          expiresAt,
          dailyTokenBudgetUsd: toCents(template.daily_token_budget_usd),
          dailySpendBudgetUsd: toCents(template.daily_spend_budget_usd),
          perTransactionMaxUsd: toCents(template.per_transaction_max_usd),
          escalateOverUsd: toCents(template.escalate_over_usd),
        },
      })
      if (template.clearance !== undefined || template.industry !== undefined) {
        await tx.agentClearance.create({
          data: {
            walletId: wallet_id,
            agentId: agent.id,
            level: template.clearance ?? 1,
            ...(template.industry !== undefined ? { industry: template.industry } : {}),
            ...(expiresAt ? { expiresAt } : {}),
          },
        })
      }
      rows.push(agent)
    }
    return rows
  })

  return NextResponse.json(
    {
      wallet_id,
      seats: created.map((agent, i) => ({
        id: agent.id,
        name: agent.name,
        holder: agent.holder,
        expires_at: agent.expiresAt,
        api_key: minted[i].key.raw,
        api_key_prefix: agent.apiKeyPrefix,
      })),
      warning: "Store these API keys now. They will not be shown again.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  )
}
