import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { applyPolicyUpdate } from "@/lib/policy"
import { findPack } from "@/lib/policyPacks"

// Apply a pack (PACK-1): one call installs the pack's fields as the wallet
// policy. Flows through applyPolicyUpdate — the single validate/convert/write
// point — so the mutation writes an immutable PolicyRevision like every other
// policy change. The evidentiary chain doesn't care whether a human typed the
// numbers or picked a pack.

const bodySchema = z.object({ wallet_id: z.string().min(1) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const walletId = parsed.data.wallet_id

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    return NextResponse.json({ error: "Unauthorized: management key required" }, { status: 401 })
  }

  const pack = findPack(id)
  if (!pack) return NextResponse.json({ error: `Unknown pack '${id}'` }, { status: 404 })

  const result = await applyPolicyUpdate(walletId, pack.policy)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(
    { applied: pack.id, wallet_id: walletId, policy: result.policy },
    { headers: { "Cache-Control": "no-store" } },
  )
}
