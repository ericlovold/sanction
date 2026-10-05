import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { authenticateOwner } from "@/lib/ownerAuth"
import { decisionCode, REMEDIATION } from "@/lib/decisions"
import { TOOL_GRANT_REMEDIATION, TOOL_REMEDIATION } from "@/lib/toolDecisions"
import { CAPABILITY_REMEDIATION } from "@/lib/capability"
import { isDecisionEvidence } from "@/lib/evidence"
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
  const grant =
    d.status === "approved"
      ? await db.grant.findFirst({
          where: { sourceType: "authorization_request", sourceId: reqRow.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, expiresAt: true, consumedAt: true },
        })
      : null

  let code: string | undefined = decisionCode(d.status, d.decisionNote)
  let remediation = code ? REMEDIATION[code as keyof typeof REMEDIATION] : undefined
  if (reqRow.kind === "tool" && code) {
    remediation = TOOL_GRANT_REMEDIATION[code as keyof typeof TOOL_GRANT_REMEDIATION] ?? remediation
  }
  const evidence = reqRow.decisionContextJson
  const typedRemediation = reqRow.kind === "tool" ? TOOL_REMEDIATION
    : reqRow.kind === "capability" ? CAPABILITY_REMEDIATION : undefined
  // Only use original rule evidence while it still describes this decision.
  // A later human rejection or timeout must keep its terminal reason/code.
  if (typedRemediation && isDecisionEvidence(evidence)
      && evidence.ladder === reqRow.kind && evidence.reason === d.decisionNote
      && ((d.status === "escalated" && evidence.effect === "escalate")
        || (d.status === "denied" && evidence.effect === "deny"))
      && evidence.code && Object.hasOwn(typedRemediation, evidence.code)) {
    code = evidence.code
    remediation = (typedRemediation as Record<string, string>)[code]
  } else if (d.status === "escalated" && typedRemediation) {
    code = reqRow.kind === "tool" ? "TOOL_ESCALATION_REQUIRED" : "CAPABILITY_ESCALATION_REQUIRED"
    remediation = (typedRemediation as Record<string, string>)[code]
  }
  return NextResponse.json({
    authorized: d.status === "approved",
    status: d.status,
    request_id: reqRow.id,
    reason: d.decisionNote ?? undefined,
    code,
    remediation,
    agent: reqRow.agent.name,
    amount_usd: reqRow.amountUsd,
    merchant: reqRow.merchant,
    decided_at: d.decidedAt,
    grant_id: grant?.id,
    grant_status: grant?.status,
    grant_consumed_at: grant?.consumedAt,
    grant_expires_at: grant?.expiresAt,
  })
}
