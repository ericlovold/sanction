import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { authenticateOwner } from "@/lib/ownerAuth"
import { decisionCode, REMEDIATION } from "@/lib/decisions"
import { settleIfExpired } from "@/lib/approvals"

// Poll the status of an authorization request. An escalated request flips to
// approved/denied once the owner resolves it; the agent that made the call
// (x-api-key) or the wallet owner (x-mgmt-key) can read it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const reqRow = await db.authorizationRequest.findUnique({
    where: { id },
    include: { agent: { select: { name: true, walletId: true, wallet: { select: { policy: true } } } } },
  })
  if (!reqRow) return NextResponse.json({ error: "Request not found" }, { status: 404 })

  const walletId = reqRow.agent.walletId
  const { agent } = await authenticateAgent(req)
  const authorizedReader = agent?.walletId === walletId || (await authenticateOwner(req, walletId)).wallet !== null
  if (!authorizedReader) {
    return NextResponse.json({ error: "Unauthorized: wallet agent key or management key required" }, { status: 401 })
  }

  // Settle the escalation if it has outlived the policy timeout (UX-2), so a
  // polling agent gets a terminal decision instead of waiting forever.
  const d = await settleIfExpired(reqRow, reqRow.agent.wallet.policy)

  const code = decisionCode(d.status, d.decisionNote)
  return NextResponse.json({
    authorized: d.status === "approved",
    status: d.status,
    request_id: reqRow.id,
    reason: d.decisionNote ?? undefined,
    code,
    remediation: code ? REMEDIATION[code] : undefined,
    agent: reqRow.agent.name,
    amount_usd: reqRow.amountUsd,
    merchant: reqRow.merchant,
    decided_at: d.decidedAt,
  })
}
