import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { resolveApproval, listPendingApprovals } from "@/lib/approvals"

// List escalations awaiting a human decision (owner only).
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const pending = await listPendingApprovals(walletId)
  return NextResponse.json({ pending })
}

const schema = z.object({
  wallet_id: z.string(),
  request_id: z.string(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
})

// Approve or reject an escalated request (owner only).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })

  const { wallet_id, request_id, decision, note } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const result = await resolveApproval(wallet_id, request_id, decision, note)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const r = result.request
  return NextResponse.json(
    { request_id: r.id, status: r.status, decided_at: r.decidedAt, note: r.decisionNote },
    { headers: { "Cache-Control": "no-store" } },
  )
}
