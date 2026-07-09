import { describe, it, expect } from "vitest"
import {
  canonical,
  genesisSeed,
  buildChain,
  buildExport,
  verifyExport,
  signRoot,
  type CanonicalDecision,
  type AuditExport,
} from "@/lib/auditChain"

const SECRET = "test-signing-secret"
const GEN = "2026-07-09T00:00:00.000Z"

function decision(id: string, over: Partial<CanonicalDecision> = {}): CanonicalDecision {
  return {
    id,
    agent_id: "agent-1",
    kind: "spend",
    action: "purchase",
    amount_usd: 10,
    merchant: "aws",
    category: "infra",
    status: "approved",
    decision_note: null,
    policy_revision: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    decided_at: "2026-07-01T00:00:00.000Z",
    ...over,
  }
}

describe("canonical", () => {
  it("is key-order independent", () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }))
  })
  it("distinguishes null from missing and preserves types", () => {
    expect(canonical({ a: null })).toBe('{"a":null}')
    expect(canonical({ a: 0 })).not.toBe(canonical({ a: "0" }))
  })
})

describe("chain binding", () => {
  it("binds the genesis seed to the wallet", () => {
    expect(genesisSeed("w1")).not.toBe(genesisSeed("w2"))
  })
  it("an empty range has head === genesis seed", () => {
    const { chain, head } = buildChain("w1", [])
    expect(chain).toEqual([])
    expect(head).toBe(genesisSeed("w1"))
  })
  it("each entry's prev is the previous entry's hash", () => {
    const { chain } = buildChain("w1", [decision("a"), decision("b"), decision("c")])
    expect(chain[0].prev).toBe(genesisSeed("w1"))
    expect(chain[1].prev).toBe(chain[0].hash)
    expect(chain[2].prev).toBe(chain[1].hash)
  })
})

describe("buildExport + verifyExport round-trip", () => {
  const decisions = [decision("a"), decision("b", { amount_usd: 250, status: "escalated" }), decision("c")]
  const doc = buildExport("w1", "2026-07-01", "2026-07-08", decisions, SECRET, GEN)

  it("a pristine export verifies", () => {
    const r = verifyExport(doc, SECRET)
    expect(r.valid).toBe(true)
    expect(r.signature_valid).toBe(true)
    expect(r.chain_valid).toBe(true)
    expect(r.broken_at).toBeUndefined()
  })

  it("is deterministic — same input, byte-identical signature", () => {
    const again = buildExport("w1", "2026-07-01", "2026-07-08", decisions, SECRET, GEN)
    expect(again.signature).toBe(doc.signature)
    expect(again.head).toBe(doc.head)
  })

  it("the wrong secret fails the signature but not the chain", () => {
    const r = verifyExport(doc, "wrong-secret")
    expect(r.signature_valid).toBe(false)
    expect(r.chain_valid).toBe(true)
    expect(r.valid).toBe(false)
  })
})

describe("tamper detection", () => {
  const decisions = [decision("a"), decision("b", { amount_usd: 100 }), decision("c")]
  const base = () => buildExport("w1", "2026-07-01", "2026-07-08", decisions, SECRET, GEN)

  it("catches an altered amount and names the link", () => {
    const doc = base()
    doc.decisions[1].amount_usd = 1 // someone shrinks a charge after the fact
    const r = verifyExport(doc, SECRET)
    expect(r.valid).toBe(false)
    expect(r.chain_valid).toBe(false)
    expect(r.broken_at?.seq).toBe(1)
    expect(r.broken_at?.id).toBe("b")
  })

  it("catches a changed status", () => {
    const doc = base()
    doc.decisions[0].status = "approved" // was already approved; flip note instead
    doc.decisions[0].decision_note = "forged"
    expect(verifyExport(doc, SECRET).valid).toBe(false)
  })

  it("catches a dropped decision (chain length mismatch)", () => {
    const doc = base()
    doc.decisions.splice(1, 1)
    const r = verifyExport(doc, SECRET)
    expect(r.valid).toBe(false)
    expect(r.broken_at).toBeDefined()
  })

  it("catches reordering", () => {
    const doc = base()
    ;[doc.decisions[0], doc.decisions[1]] = [doc.decisions[1], doc.decisions[0]]
    expect(verifyExport(doc, SECRET).valid).toBe(false)
  })

  it("catches a re-chained forgery when the secret is unknown", () => {
    // Attacker alters a decision AND recomputes the chain to hide it, but cannot
    // re-sign the root without the secret.
    const doc = base()
    doc.decisions[1].amount_usd = 1
    const rebuilt = buildExport(doc.wallet_id, doc.from, doc.to, doc.decisions, "attacker-secret", doc.generated_at)
    const forged: AuditExport = { ...rebuilt, signature: doc.signature } // keep the old (now-wrong) signature
    const r = verifyExport(forged, SECRET)
    expect(r.chain_valid).toBe(true) // internally consistent...
    expect(r.signature_valid).toBe(false) // ...but not attested by Sanction
    expect(r.valid).toBe(false)
  })

  it("catches a forged head", () => {
    const doc = base()
    doc.head = "deadbeef"
    const r = verifyExport(doc, SECRET)
    expect(r.valid).toBe(false)
  })

  it("catches a lied-about count", () => {
    const doc = base()
    doc.count = 99
    // re-sign so the signature matches the lie; the decisions-vs-count check still fails
    doc.signature = signRoot(
      { version: doc.version, algo: doc.algo, wallet_id: doc.wallet_id, from: doc.from, to: doc.to, count: 99, head: doc.head },
      SECRET,
    )
    const r = verifyExport(doc, SECRET)
    expect(r.valid).toBe(false)
    expect(r.broken_at?.reason).toContain("count")
  })
})
