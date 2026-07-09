import { createHash, createHmac, timingSafeEqual } from "crypto"

// Tamper-evident audit export (AUDIT-1). A signed, hash-chained snapshot of a
// wallet's governed decisions. Each entry commits to a canonical serialization
// of the decision AND the previous entry's hash, so altering, dropping, or
// reordering any decision breaks the chain from that point forward. The chain
// head is signed with the platform signing secret, binding the whole export to
// Sanction at export time.
//
// Honesty contract: this makes the EXPORTED evidence tamper-evident — a verifier
// (a regulator, an auditor, the customer themselves) can prove that no decision
// in the export was altered, dropped, or reordered after signing, and that
// Sanction attests to the set. It is NOT a write-time notary: on its own it does
// not prevent a privileged DB-level rewrite of a row *before* the export is
// taken. Sealing periodic chain anchors to catch across-time edits is the
// follow-up (AUDIT-2, tracked in docs/BACKLOG.md). The pure functions here read
// no IO and take the signing secret explicitly, so they replay deterministically
// and unit-test without a database or environment.

export const AUDIT_VERSION = "sanction-audit-v1"
export const AUDIT_ALGO = "sha256-chain+hmac-sha256"

// The exact, ordered, whitespace-free fields the chain commits to. Any decision
// column not listed here is display-only and does NOT affect the hash — the set
// below is the governed record: who, what, how much, the ruling, the evidence
// pointer, and when. Keys are serialized in this fixed order (see canonical()).
export type CanonicalDecision = {
  id: string
  agent_id: string
  kind: string
  action: string
  amount_usd: number
  merchant: string
  category: string
  status: string
  decision_note: string | null
  policy_revision: number | null
  created_at: string // ISO 8601
  decided_at: string | null // ISO 8601
}

export type ChainEntry = {
  seq: number // 0-based position in the chain
  id: string // decision id, for locating a broken link
  prev: string // hash of the previous entry (or the genesis seed for seq 0)
  hash: string // sha256(prev + "\n" + canonical(decision))
}

// The signed commitment. Everything a verifier needs is here except the secret;
// the signature binds these fields, so tampering with count/range/head is caught.
export type AuditRoot = {
  version: string
  algo: string
  wallet_id: string
  from: string
  to: string
  count: number
  head: string // hash of the last entry, or the genesis seed when count === 0
}

export type AuditExport = AuditRoot & {
  generated_at: string
  decisions: CanonicalDecision[]
  chain: ChainEntry[]
  signature: string // "sha256=" + HMAC over canonical(root)
}

// Deterministic JSON: object keys sorted, no incidental whitespace. Two exports
// of the same decisions serialize byte-identically regardless of field order in
// the source object, so the hash is stable across code paths and languages.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}"
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

// Genesis seed binds a chain to its wallet: one wallet's export can never be
// grafted onto another's, because entry 0's `prev` differs.
export function genesisSeed(walletId: string): string {
  return sha256(AUDIT_VERSION + ":" + walletId)
}

export function hashEntry(prev: string, d: CanonicalDecision): string {
  return sha256(prev + "\n" + canonical(d))
}

// Fold decisions (already in stable order — createdAt asc, id tiebreak) into a
// chain. Returns the entries and the head (last hash, or the seed when empty).
export function buildChain(walletId: string, decisions: CanonicalDecision[]): { chain: ChainEntry[]; head: string } {
  let prev = genesisSeed(walletId)
  const chain: ChainEntry[] = []
  decisions.forEach((d, seq) => {
    const hash = hashEntry(prev, d)
    chain.push({ seq, id: d.id, prev, hash })
    prev = hash
  })
  return { chain, head: prev }
}

export function signRoot(root: AuditRoot, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(canonical(root), "utf8").digest("hex")
}

// Timing-safe signature comparison; length-guards so an attacker can't probe the
// digest length. Never throws — a malformed signature is simply invalid.
export function signatureValid(root: AuditRoot, signature: string, secret: string): boolean {
  const expected = signRoot(root, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(typeof signature === "string" ? signature : "")
  return a.length === b.length && timingSafeEqual(a, b)
}

export function buildExport(
  walletId: string,
  from: string,
  to: string,
  decisions: CanonicalDecision[],
  secret: string,
  generatedAt: string,
): AuditExport {
  const { chain, head } = buildChain(walletId, decisions)
  const root: AuditRoot = {
    version: AUDIT_VERSION,
    algo: AUDIT_ALGO,
    wallet_id: walletId,
    from,
    to,
    count: decisions.length,
    head,
  }
  return { ...root, generated_at: generatedAt, decisions, chain, signature: signRoot(root, secret) }
}

export type VerifyResult = {
  valid: boolean
  signature_valid: boolean
  chain_valid: boolean
  count: number
  head: string
  // First place the recomputed chain diverges from the document, if any. A break
  // means a decision was altered, inserted, dropped, or reordered.
  broken_at?: { seq: number; id: string; reason: string }
}

// Recompute the chain from the document's own decisions and re-check the
// signature. Self-contained: needs no database — the export carries everything
// but the secret. This is what a customer or auditor runs to trust an export.
export function verifyExport(doc: AuditExport, secret: string): VerifyResult {
  const { chain: recomputed, head } = buildChain(doc.wallet_id, doc.decisions)

  let broken_at: VerifyResult["broken_at"] | undefined
  if (doc.chain.length !== recomputed.length) {
    broken_at = {
      seq: Math.min(doc.chain.length, recomputed.length),
      id: "",
      reason: `chain length ${doc.chain.length} does not match ${recomputed.length} decisions`,
    }
  } else {
    for (let i = 0; i < recomputed.length; i++) {
      const claimed = doc.chain[i]
      const actual = recomputed[i]
      if (claimed.hash !== actual.hash || claimed.prev !== actual.prev || claimed.id !== actual.id) {
        broken_at = { seq: i, id: actual.id, reason: "entry hash does not match its decision" }
        break
      }
    }
  }

  const headOk = head === doc.head
  const chain_valid = !broken_at && headOk

  const root: AuditRoot = {
    version: doc.version,
    algo: doc.algo,
    wallet_id: doc.wallet_id,
    from: doc.from,
    to: doc.to,
    count: doc.count,
    head: doc.head,
  }
  const signature_valid = signatureValid(root, doc.signature, secret)

  if (!broken_at && !headOk) {
    broken_at = { seq: recomputed.length, id: "", reason: "head hash does not match the chain" }
  }
  if (!broken_at && doc.count !== doc.decisions.length) {
    broken_at = { seq: doc.decisions.length, id: "", reason: `count ${doc.count} does not match ${doc.decisions.length} decisions` }
  }

  return {
    valid: chain_valid && signature_valid && doc.count === doc.decisions.length,
    signature_valid,
    chain_valid: chain_valid && doc.count === doc.decisions.length,
    count: doc.decisions.length,
    head,
    ...(broken_at ? { broken_at } : {}),
  }
}
