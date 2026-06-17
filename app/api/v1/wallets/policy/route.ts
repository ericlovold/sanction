import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { applyPolicyUpdate, policyToDollars } from "@/lib/policy"

// Read the current policy (owner only).
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const policy = await db.policy.findUnique({ where: { walletId } })
  if (!policy) return NextResponse.json({ error: "No policy configured" }, { status: 404 })
  return NextResponse.json({ wallet_id: walletId, policy: policyToDollars(policy) })
}

// Update budgets, thresholds, and categories (owner only). Partial — only the
// fields you send change. Amounts are in dollars.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const walletId = (body as { wallet_id?: string }).wallet_id
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const { wallet_id: _omit, ...fields } = body as Record<string, unknown>
  const result = await applyPolicyUpdate(walletId, fields)
  if (!result.ok) return NextResponse.json({ error: result.error, details: result.details }, { status: 400 })

  return NextResponse.json({ wallet_id: walletId, policy: result.policy }, { headers: { "Cache-Control": "no-store" } })
}
