import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateManagementKey } from "@/lib/apiKey"

const schema = z.object({ wallet_id: z.string() })

/**
 * One-time bootstrap of a management key for a wallet created before the
 * management plane existed (mgmtKeyHash is null). Guarded by the deployment's
 * SANCTION_ADMIN_SECRET (x-admin-secret header). Refuses to overwrite a wallet
 * that already has a key — rotation is a separate, owner-authenticated flow.
 */
export async function POST(req: NextRequest) {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Bootstrap disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  const provided = req.headers.get("x-admin-secret") ?? ""
  if (!constantTimeEqual(provided, adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const wallet = await db.wallet.findUnique({ where: { id: parsed.data.wallet_id } })
  if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 })
  if (wallet.mgmtKeyHash) {
    return NextResponse.json({ error: "Wallet already has a management key" }, { status: 409 })
  }

  const mgmt = generateManagementKey()
  await db.wallet.update({
    where: { id: wallet.id },
    data: { mgmtKeyHash: mgmt.hash, mgmtKeyPrefix: mgmt.prefix },
  })

  return NextResponse.json({
    wallet_id: wallet.id,
    management_key: mgmt.raw,
    management_key_prefix: mgmt.prefix,
    warning: "Store this management key now. It will not be shown again.",
  }, { status: 201 })
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
