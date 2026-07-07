import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { upsertPolicyWithRevision } from "@/lib/policy"
import { walletSubtreeIds } from "@/lib/poolAccess"

// Reallocation (REALLOC-1): move budget between two pools in the caller's
// subtree — the API hook a learning layer (or a human) uses to shift money
// toward the efficient channel. Moves subtree_daily_cap_usd, the same cap the
// pools dashboard allocates. Both cap changes write PolicyRevision snapshots
// (EVID-1) inside one transaction, and a BudgetReallocation row ties the pair
// together as a single auditable event.

const schema = z.object({
  wallet_id: z.string().min(1), // the caller's wallet — authorization root
  from_wallet_id: z.string().min(1),
  to_wallet_id: z.string().min(1),
  amount_usd: z.number().positive().max(1_000_000),
  reason: z.string().trim().max(300).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, from_wallet_id, to_wallet_id, amount_usd, reason } = parsed.data
  if (from_wallet_id === to_wallet_id) {
    return NextResponse.json({ error: "from_wallet_id and to_wallet_id must differ" }, { status: 400 })
  }

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // Both pools must live in the caller's subtree — the same access rule the
  // pools dashboard enforces.
  const allowed = await walletSubtreeIds(db, wallet_id)
  if (!allowed.includes(from_wallet_id) || !allowed.includes(to_wallet_id)) {
    return NextResponse.json({ error: "Both pools must be in your wallet subtree" }, { status: 403 })
  }

  const amountCents = Math.round(amount_usd * 100)

  const result = await db.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.policy.findUnique({ where: { walletId: from_wallet_id }, select: { subtreeDailyCapUsd: true } }),
      tx.policy.findUnique({ where: { walletId: to_wallet_id }, select: { subtreeDailyCapUsd: true } }),
    ])
    const fromCap = from?.subtreeDailyCapUsd
    if (fromCap == null) {
      return { ok: false as const, error: "Source pool has no subtree cap to move" }
    }
    if (fromCap < amountCents) {
      return { ok: false as const, error: `Source cap is $${fromCap / 100}; cannot move $${amountCents / 100}` }
    }
    const toCap = to?.subtreeDailyCapUsd ?? 0

    await upsertPolicyWithRevision(tx, from_wallet_id, { subtreeDailyCapUsd: fromCap - amountCents })
    await upsertPolicyWithRevision(tx, to_wallet_id, { subtreeDailyCapUsd: toCap + amountCents })
    const move = await tx.budgetReallocation.create({
      data: {
        fromWalletId: from_wallet_id,
        toWalletId: to_wallet_id,
        amountCents,
        reason: reason ?? null,
        actor: "api",
      },
    })
    return {
      ok: true as const,
      moveId: move.id,
      fromCapCents: fromCap - amountCents,
      toCapCents: toCap + amountCents,
    }
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({
    reallocation_id: result.moveId,
    moved_usd: amount_usd,
    from: { wallet_id: from_wallet_id, subtree_daily_cap_usd: result.fromCapCents / 100 },
    to: { wallet_id: to_wallet_id, subtree_daily_cap_usd: result.toCapCents / 100 },
    reason: reason ?? null,
  })
}
