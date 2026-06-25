import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateManagementKey } from "@/lib/apiKey"
import { rateLimit, clientIp } from "@/lib/rateLimit"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  name: z.string().min(1).max(64),
  owner_email: z.string().email(),
  // Create as a sub-account under this wallet (account tree). Requires the
  // parent's management key. Omit for a normal root wallet sign-up.
  parent_id: z.string().optional(),
})

// Sign-up entry point. A root wallet is unauthenticated + IP-throttled; nesting
// a sub-account under a parent (parent_id) is a management action that requires
// the parent's management key. Returns a management key (shown once).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, owner_email, parent_id } = parsed.data

  if (parent_id) {
    // Authenticated nesting under a parent — no IP throttle (it's a trusted op).
    const owner = await authenticateOwner(req, parent_id)
    if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })
  } else {
    // Unauthenticated root sign-up + creates rows: throttle to stop mass spam.
    const rl = await rateLimit("wallet_create", clientIp(req), 15, 3600)
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many wallets created from this IP. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 3600) } },
      )
    }
  }

  const mgmt = generateManagementKey()

  let wallet
  try {
    wallet = await db.wallet.create({
      data: {
        name,
        ownerEmail: owner_email,
        parentId: parent_id ?? null,
        mgmtKeyHash: mgmt.hash,
        mgmtKeyPrefix: mgmt.prefix,
        policy: {
          create: {}, // defaults from schema
        },
      },
      include: { policy: true },
    })
  } catch (e: unknown) {
    // Unique violation on ownerEmail => a wallet already exists for this email.
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "A wallet already exists for this email. Sign in with your management key instead." },
        { status: 409 },
      )
    }
    throw e
  }

  return NextResponse.json({
    id: wallet.id,
    name: wallet.name,
    owner_email: wallet.ownerEmail,
    parent_id: wallet.parentId,
    management_key: mgmt.raw,
    management_key_prefix: mgmt.prefix,
    warning: "Store this management key now. It will not be shown again. Required (x-mgmt-key) to manage this wallet.",
    created_at: wallet.createdAt,
  }, { status: 201, headers: { "Cache-Control": "no-store" } })
}
