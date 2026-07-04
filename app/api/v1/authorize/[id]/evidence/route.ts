import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { authenticateOwner } from "@/lib/ownerAuth"
import { decisionCode } from "@/lib/decisions"
import { replayEvidence, type DecisionEvidence } from "@/lib/evidence"

// EVID-1: the evidence view of a decision. Returns the policy revision that
// was in force, the exact engine context the decision evaluated, and a live
// replay — the pure ladder re-run over the stored context — proving the
// record still reproduces the outcome. "Prove the engine made the correct
// decision under the policy that existed then" is this endpoint.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const row = await db.authorizationRequest.findUnique({
    where: { id },
    include: { agent: { select: { name: true, walletId: true } } },
  })
  if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 })

  // Same readers as the poll endpoint: the wallet's agents or its owner.
  const walletId = row.agent.walletId
  const { agent } = await authenticateAgent(req)
  const authorizedReader = agent?.walletId === walletId || (await authenticateOwner(req, walletId)).wallet !== null
  if (!authorizedReader) {
    return NextResponse.json({ error: "Unauthorized: wallet agent key or management key required" }, { status: 401 })
  }

  const revision =
    row.policyRevision !== null
      ? await db.policyRevision.findFirst({
          where: { walletId, revision: row.policyRevision },
          select: { revision: true, snapshotJson: true, createdAt: true },
        })
      : null

  const evidence = row.decisionContextJson as DecisionEvidence | null
  const replay = evidence ? replayEvidence(evidence) : null

  return NextResponse.json({
    request_id: row.id,
    kind: row.kind,
    status: row.status,
    decided_at: row.decidedAt,
    decision_note: row.decisionNote ?? undefined,
    code: decisionCode(row.status, row.decisionNote),
    agent: row.agent.name,
    // The policy that was in force when the engine decided (cents, immutable).
    policy_revision: revision
      ? { revision: revision.revision, created_at: revision.createdAt, policy: revision.snapshotJson }
      : null,
    // What the engine saw and concluded at decision time.
    decision: evidence
      ? { ladder: evidence.ladder, effect: evidence.effect, rule_id: evidence.rule_id, code: evidence.code, reason: evidence.reason }
      : null,
    context: evidence?.ctx ?? null,
    // The pure ladder re-run over the stored context, right now. matches:true
    // means the record reproduces the decision — determinism, demonstrated.
    replay,
  })
}
