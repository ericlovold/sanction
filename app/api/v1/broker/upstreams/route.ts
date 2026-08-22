import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { withTenant } from "@/lib/rls"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { UPSTREAM_LABEL_PREFIX, upstreamConfigSchema, validateUpstreamRegistration } from "@/lib/broker"

// BROKER-1: register the MCP servers a wallet's broker may front. The config
// (URL + optional upstream auth header) is SEC-1 envelope-encrypted under the
// reserved `mcp:<name>` label — the same pattern as `provider:<id>`. The
// upstream credential lives in the wallet, never in the agent's environment:
// the agent holds only its Sanction key and speaks to /mcp/broker/<name>.
//
// minClearance 5 + a non-empty impossible allow-list keeps these rows out of
// the credential-injection surface entirely; only the broker reads them,
// server-side.

const registerSchema = z.object({
  wallet_id: z.string(),
  name: z.string().min(1).max(40),
  url: z.string().min(1).max(2048),
  auth_header: z.string().trim().min(1).max(64).optional(),
  auth_value: z.string().min(1).max(4096).optional(),
})

export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, name, url, auth_header, auth_value } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const config = upstreamConfigSchema.parse({ url, auth_header, auth_value })
  const invalid = validateUpstreamRegistration(name, config)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const label = `${UPSTREAM_LABEL_PREFIX}${name}`
  const { blob, keyId } = await encryptCredentialEnvelope(JSON.stringify(config), wallet_id, label)

  const row = await withTenant(wallet_id, async (tx) => {
    // Re-registering a name revokes the old row — one live config per name.
    await tx.credentialVault.updateMany({
      where: { walletId: wallet_id, label, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return tx.credentialVault.create({
      data: {
        walletId: wallet_id,
        label,
        type: "api_key",
        encryptedValue: blob,
        keyId,
        minClearance: 5,
        allowedAgentIds: ["broker-internal-only"],
        scopes: ["mcp-broker"],
      },
    })
  })

  return NextResponse.json(
    {
      name,
      url: config.url,
      auth: config.auth_header ? { header: config.auth_header } : null,
      broker_url: `/mcp/broker/${name}`,
      created_at: row.createdAt,
    },
    { status: 201 },
  )
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id") ?? ""
  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const rows = await withTenant(walletId, (tx) =>
    tx.credentialVault.findMany({
      where: { walletId, label: { startsWith: UPSTREAM_LABEL_PREFIX }, revokedAt: null },
      select: { label: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  )
  return NextResponse.json({
    upstreams: rows.map((r) => ({
      name: r.label.slice(UPSTREAM_LABEL_PREFIX.length),
      broker_url: `/mcp/broker/${r.label.slice(UPSTREAM_LABEL_PREFIX.length)}`,
      created_at: r.createdAt,
    })),
  })
}

export async function DELETE(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id") ?? ""
  const name = req.nextUrl.searchParams.get("name") ?? ""
  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const result = await withTenant(walletId, (tx) =>
    tx.credentialVault.updateMany({
      where: { walletId, label: `${UPSTREAM_LABEL_PREFIX}${name}`, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  )
  if (result.count === 0) return NextResponse.json({ error: `No upstream named '${name}'` }, { status: 404 })
  return NextResponse.json({ removed: name })
}
