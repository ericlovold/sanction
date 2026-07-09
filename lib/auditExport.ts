import { db } from "./db"
import { buildExport, type CanonicalDecision, type AuditExport } from "./auditChain"

// The DB read behind GET /v1/audit/export. Owner-only auth and range parsing
// live in the route; this owns the query, the canonical mapping, and the fixed
// ordering the chain depends on. Ordering is (createdAt asc, id asc) — a total
// order that's stable even for rows sharing a millisecond, so the same window
// always produces the same chain and the same signature.

export const MAX_EXPORT_ROWS = 10000

function toCanonical(r: {
  id: string
  agentId: string
  kind: string
  action: string
  amountUsd: number
  merchant: string
  category: string
  status: string
  decisionNote: string | null
  policyRevision: number | null
  createdAt: Date
  decidedAt: Date | null
}): CanonicalDecision {
  return {
    id: r.id,
    agent_id: r.agentId,
    kind: r.kind,
    action: r.action,
    amount_usd: r.amountUsd,
    merchant: r.merchant,
    category: r.category,
    status: r.status,
    decision_note: r.decisionNote,
    policy_revision: r.policyRevision,
    created_at: r.createdAt.toISOString(),
    decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
  }
}

export async function buildWalletExport(
  walletId: string,
  from: string,
  to: string,
  start: Date,
  end: Date,
  secret: string,
  generatedAt: string,
): Promise<{ export: AuditExport; truncated: boolean }> {
  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
  const rows = await db.authorizationRequest.findMany({
    where: { agentId: { in: agents.map((a) => a.id) }, createdAt: { gte: start, lt: end } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS + 1,
    select: {
      id: true, agentId: true, kind: true, action: true, amountUsd: true,
      merchant: true, category: true, status: true, decisionNote: true,
      policyRevision: true, createdAt: true, decidedAt: true,
    },
  })
  const truncated = rows.length > MAX_EXPORT_ROWS
  const considered = rows.slice(0, MAX_EXPORT_ROWS)
  const decisions = considered.map(toCanonical)
  return { export: buildExport(walletId, from, to, decisions, secret, generatedAt), truncated }
}
