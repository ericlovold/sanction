import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  jti: z.string(),
})

// Owner revokes an outstanding execution token before its TTL elapses.
// The inject path already refuses any token whose status !== "active", so this
// takes effect immediately. Scoped to the owner's own wallet.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, jti } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // updateMany scopes the write to this wallet — an owner can never revoke
  // another tenant's token by guessing a jti.
  const result = await db.executionToken.updateMany({
    where: { id: jti, walletId: wallet_id, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  })

  if (result.count === 0) {
    return NextResponse.json(
      { error: "No active token with that jti for this wallet" },
      { status: 404 },
    )
  }

  return NextResponse.json({ jti, status: "revoked", revoked_at: new Date().toISOString() })
}
