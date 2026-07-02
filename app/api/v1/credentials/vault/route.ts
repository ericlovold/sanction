import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { authenticateOwner } from "@/lib/ownerAuth"
import { withTenant } from "@/lib/rls"

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

  // RLS-scoped write (SEC-3): the policy's WITH CHECK refuses an insert whose
  // walletId differs from the tenant context, so a credential can never be
  // written into another tenant's vault — beneath the SEC-1 envelope above.
  const cred = await withTenant(wallet_id, (tx) =>
    tx.credentialVault.create({
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
    }),
  )

  return NextResponse.json({ ...cred, value: "[encrypted]" }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const credentials = await withTenant(walletId, (tx) =>
    tx.credentialVault.findMany({
      where: { walletId },
      select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, minClearance: true, expiresAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  )

  return NextResponse.json({ credentials })
}

const patchSchema = z.object({
  wallet_id: z.string(),
  id: z.string(),
  label: z.string().min(1).max(64).optional(),
  allowed_agent_ids: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  min_clearance: z.number().int().min(1).max(5).optional(),
  expires_at: z.string().datetime().nullable().optional(),
})

// Edit a credential's metadata (label, scopes, allowed agents, min clearance,
// expiry). The secret value itself is immutable — re-create to rotate it.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, id, label, allowed_agent_ids, scopes, min_clearance, expires_at } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // RLS-scoped (SEC-3): the lookup can only see this tenant's rows, so a
  // cross-tenant id simply reads as not-found.
  const updated = await withTenant(wallet_id, async (tx) => {
    const cred = await tx.credentialVault.findUnique({ where: { id } })
    if (!cred || cred.walletId !== wallet_id) return null
    return tx.credentialVault.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(allowed_agent_ids !== undefined ? { allowedAgentIds: allowed_agent_ids } : {}),
        ...(scopes !== undefined ? { scopes } : {}),
        ...(min_clearance !== undefined ? { minClearance: min_clearance } : {}),
        ...(expires_at !== undefined ? { expiresAt: expires_at === null ? null : new Date(expires_at) } : {}),
      },
      select: { id: true, label: true, type: true, scopes: true, allowedAgentIds: true, minClearance: true, expiresAt: true, revokedAt: true, createdAt: true },
    })
  })
  if (!updated) return NextResponse.json({ error: "Credential not found" }, { status: 404 })
  return NextResponse.json({ credential: updated }, { headers: { "Cache-Control": "no-store" } })
}

// Retire a credential (soft delete). It can no longer be injected, but its
// injection audit history is preserved — we never hard-delete the trail.
export async function DELETE(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  const id = req.nextUrl.searchParams.get("id")
  if (!walletId || !id) return NextResponse.json({ error: "wallet_id and id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const retired = await withTenant(walletId, async (tx) => {
    const cred = await tx.credentialVault.findUnique({ where: { id } })
    if (!cred || cred.walletId !== walletId) return false
    await tx.credentialVault.update({ where: { id }, data: { revokedAt: new Date() } })
    return true
  })
  if (!retired) return NextResponse.json({ error: "Credential not found" }, { status: 404 })
  return NextResponse.json({ retired: id })
}
