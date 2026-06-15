import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { encryptCredential } from "@/lib/jwt"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  label: z.string().min(1).max(64),
  type: z.enum(["api_key", "oauth_token", "certificate", "license", "password"]),
  value: z.string().min(1),
  allowed_agent_ids: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  expires_at: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, label, type, value, allowed_agent_ids, scopes, expires_at } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // Bind the ciphertext to its tenant+label so a leaked blob can't be replayed
  // under a different wallet/label (AAD must match on decrypt).
  const encrypted = encryptCredential(value, `${wallet_id}:${label}`)

  const cred = await db.credentialVault.create({
    data: {
      walletId: wallet_id,
      label,
      type,
      encryptedValue: encrypted,
      allowedAgentIds: allowed_agent_ids,
      scopes,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
    },
    select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, createdAt: true },
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
    select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ credentials })
}
