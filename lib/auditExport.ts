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
  // Optional query scope: when the caller widened to a subtree, the export
  // chains every decision across these wallets while the doc's identity stays
  // the root `walletId`. Defaults to just the root — single-wallet, unchanged.
  walletIds?: string[],
): Promise<{ export: AuditExport; truncated: boolean }> {
  const scopeIds = walletIds ?? [walletId]
  const agents = await db.agent.findMany({ where: { walletId: { in: scopeIds } }, select: { id: true } })
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

// EU AI Act evidence framing (AI-ACT-1). A descriptive block that maps THIS
// signed export onto the Act's operator obligations — Art 12 (record-keeping),
// 13 (transparency), 14 (human oversight) — plus the append-only retention
// statement and a decision-count summary. It sits alongside the signed
// decisions/chain/signature (which it never alters), so verification is
// unaffected. Deliberately non-overclaiming: evidence to SUPPORT obligations,
// not a certification. Pure over the export doc — unit-testable.
export type EuAiActFraming = {
  framework: string
  disclaimer: string
  integrity: { algorithm: string; signed_head: string; verify: string }
  articles: Record<"art_12_record_keeping" | "art_13_transparency" | "art_14_human_oversight", string>
  retention: { model: string; statement: string }
  decision_counts: { total: number; approved: number; denied: number; escalated: number; human_resolved: number }
}

export function euAiActFraming(doc: AuditExport): EuAiActFraming {
  const counts = { total: doc.count, approved: 0, denied: 0, escalated: 0, human_resolved: 0 }
  for (const d of doc.decisions) {
    if (d.status === "approved") counts.approved++
    else if (d.status === "denied") counts.denied++
    else if (d.status === "escalated") counts.escalated++
    // A decision resolved by a human carries "Approved by <actor>" / "Rejected
    // by <actor>" in its note; auto-decisions and policy timeouts do not.
    if (/^(Approved|Rejected) by /.test(d.decision_note ?? "")) counts.human_resolved++
  }
  return {
    framework: "EU AI Act (Regulation (EU) 2024/1689)",
    disclaimer:
      "Evidence to support Article 12 (record-keeping), 13 (transparency) and 14 (human oversight) obligations for AI systems you operate. Not legal advice and not a compliance certification.",
    integrity: {
      algorithm: doc.algo,
      signed_head: doc.head,
      verify: "POST this document to /api/v1/audit/verify to confirm the hash chain and HMAC signature — proof nothing was altered, dropped, or reordered after signing.",
    },
    articles: {
      art_12_record_keeping:
        "Every governed agent decision below is an automatically-logged event, hash-chained to its predecessor and signed at the head. Altering, dropping, or reordering any entry breaks the chain.",
      art_13_transparency:
        "Each decision records its outcome and the policy revision (policy_revision) it ran under, and can be replayed to reproduce the decision from the stored context.",
      art_14_human_oversight:
        "Decisions that escalated were resolved by a named human — the approver identity, timestamp, and rationale are recorded (decision_note here; full approver on the approval record). human_resolved counts them.",
    },
    retention: {
      model: "append-only",
      statement:
        "The audit trail is append-only: decisions, token logs, and credential-injection records are never modified or deleted after write. This export is a signed snapshot of the requested range.",
    },
    decision_counts: counts,
  }
}
