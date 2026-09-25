import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { revokeActiveExecutionTokens } from "@/lib/executionTokens"

// Freeze (KILL-1): the owner's one-control stop. Freezing a wallet pauses every
// data-plane action for it AND its whole subtree (enforcement walks ancestors),
// deleting nothing — unfreeze resumes exactly where the fleet stopped.

const schema = z.object({
  wallet_id: z.string().min(1),
  reason: z.string().trim().max(300).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, reason } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const wallet = await db.wallet.update({
    where: { id: wallet_id },
    data: { frozenAt: new Date(), frozenReason: reason ?? null },
    select: { id: true, frozenAt: true, frozenReason: true },
  })
  // Descendant wallets' tokens are refused at inject by the ancestor walk.
  await revokeActiveExecutionTokens({ walletId: wallet_id })
  return NextResponse.json({
    wallet_id: wallet.id,
    frozen: true,
    frozen_at: wallet.frozenAt,
    reason: wallet.frozenReason,
    scope: "wallet and entire subtree",
  })
}
