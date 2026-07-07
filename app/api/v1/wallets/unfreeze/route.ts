import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"

// Unfreeze (KILL-1): lift the owner's stop. Only clears THIS wallet's freeze —
// a frozen ancestor still blocks the subtree (tighten-never-loosen holds).

const schema = z.object({ wallet_id: z.string().min(1) })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const wallet = await db.wallet.update({
    where: { id: wallet_id },
    data: { frozenAt: null, frozenReason: null },
    select: { id: true },
  })
  return NextResponse.json({ wallet_id: wallet.id, frozen: false })
}
