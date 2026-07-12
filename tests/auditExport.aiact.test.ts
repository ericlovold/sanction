import { describe, it, expect } from "vitest"
import { euAiActFraming } from "../lib/auditExport"
import { buildExport, verifyExport, type CanonicalDecision } from "../lib/auditChain"

// AI-ACT-1: the EU AI Act framing maps a signed export onto Art 12/13/14 +
// retention, and must NOT disturb the integrity proof — the chain and signature
// still verify with the ai_act block attached.

const SECRET = "test-signing-secret-material"

function decision(over: Partial<CanonicalDecision>): CanonicalDecision {
  return {
    id: "d1", agent_id: "a1", kind: "spend", action: "purchase", amount_usd: 5,
    merchant: "OpenAI", category: "software", status: "approved", decision_note: null,
    policy_revision: 3, created_at: "2026-07-01T10:00:00.000Z", decided_at: "2026-07-01T10:00:00.000Z",
    ...over,
  }
}

describe("euAiActFraming", () => {
  const decisions = [
    decision({ id: "d1", status: "approved", decision_note: "Auto-approved (under floor)" }),
    decision({ id: "d2", status: "denied", decision_note: "Category 'crypto' is blocked" }),
    decision({ id: "d3", status: "approved", decision_note: "Approved by jane@acme.co" }), // human
    decision({ id: "d4", status: "denied", decision_note: "Rejected by ops@acme.co" }), // human
    decision({ id: "d5", status: "escalated", decision_note: null }),
  ]
  const doc = buildExport("wallet_1", "2026-07-01", "2026-07-01", decisions, SECRET, "2026-07-02T00:00:00.000Z")

  it("counts decisions by status and identifies human-resolved ones by their note", () => {
    const f = euAiActFraming(doc)
    expect(f.decision_counts).toEqual({ total: 5, approved: 2, denied: 2, escalated: 1, human_resolved: 2 })
  })

  it("carries the Article mapping, retention statement, and a non-overclaiming disclaimer", () => {
    const f = euAiActFraming(doc)
    expect(f.framework).toContain("EU AI Act")
    expect(f.disclaimer.toLowerCase()).toContain("not a compliance certification")
    expect(f.retention.model).toBe("append-only")
    expect(Object.keys(f.articles)).toEqual(["art_12_record_keeping", "art_13_transparency", "art_14_human_oversight"])
    expect(f.integrity.signed_head).toBe(doc.head)
  })

  it("does not disturb the signed chain — verify still passes with ai_act attached", () => {
    const framed = { ...doc, ai_act: euAiActFraming(doc) }
    // verifyExport reads decisions/chain/signature; the sibling block is ignored.
    const v = verifyExport(framed, SECRET)
    expect(v.valid).toBe(true)
    expect(v.chain_valid).toBe(true)
    expect(v.signature_valid).toBe(true)
  })
})
