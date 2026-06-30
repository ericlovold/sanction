import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  label: z.string().min(1).max(64),
  type: z.enum(["api_key", "oauth_token", "certificate", "license", "password"]),
  value: z.string().min(1),
  allowed_agent_ids: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  min_clearance: z.number().int().min(1).max(5).default(1),
  expires_at: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, label, type, value, allowed_agent_ids, scopes, min_clearance, expires_at } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // Envelope-encrypt under the wallet's KMS-wrapped DEK (SEC-1). The ciphertext
  // is bound to its tenant+label via AAD, and keyId names the wrapping key so the
  // blob is unreadable from the database alone.
  const { blob, keyId } = await encryptCredentialEnvelope(value, wallet_id, label)

  const cred = await db.credentialVault.create({
    data: {
      walletId: wallet_id,
      label,
      type,
      encryptedValue: blob,
      keyId,
      allowedAgentIds: allowed_agent_ids,
      scopes,
      minClearance: min_clearance,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
    },
    select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, minClearance: true, createdAt: true },
  })

  return NextResponse.json({ ...cred, value: "[encrypted]" }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const credentials = await db.credentialVault.findMany({
    where: { walletId },
    select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, minClearance: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ credentials })
}
