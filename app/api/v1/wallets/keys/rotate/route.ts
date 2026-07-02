import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { rotateWalletKey } from "@/lib/credentialCrypto"

const schema = z.object({
  wallet_id: z.string(),
})

// SEC-1 Phase 2: rotate the wallet's data-encryption key. Management-plane only.
// The retired key stays stored so existing blobs keep decrypting; each blob is
// re-wrapped to the new key on its next read. Safe to call at any time; safe to
// call twice (the second rotation retires the first's key).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const rotated = await rotateWalletKey(wallet_id)
  return NextResponse.json({
    key_id: rotated.keyId,
    key_ref: rotated.keyRef === "local" ? "local" : "kms",
    retired_previous: rotated.retiredPrevious,
    rotated_at: new Date().toISOString(),
    note: "Existing credentials remain readable and re-encrypt to the new key on next use.",
  })
}
