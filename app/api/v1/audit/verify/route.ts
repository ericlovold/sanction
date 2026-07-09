import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { verifyExport, type AuditExport } from "@/lib/auditChain"

// Verify a tamper-evident audit export (AUDIT-1). POST an export document
// (exactly as GET /v1/audit/export returned it) and Sanction recomputes the
// hash chain from the document's own decisions and re-checks the signature —
// self-contained, no database read. A `valid: false` result names the first
// broken link so tampering is located, not just detected.
//
// Owner-gated on the wallet named in the document: verification reveals whether
// an export attributed to your wallet is authentic, which is management-plane
// information. The check itself never signs anything, so it is not an oracle.

const decisionSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  kind: z.string(),
  action: z.string(),
  amount_usd: z.number(),
  merchant: z.string(),
  category: z.string(),
  status: z.string(),
  decision_note: z.string().nullable(),
  policy_revision: z.number().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
})

const chainSchema = z.object({
  seq: z.number(),
  id: z.string(),
  prev: z.string(),
  hash: z.string(),
})

const exportSchema = z.object({
  version: z.string(),
  algo: z.string(),
  wallet_id: z.string().min(1),
  from: z.string(),
  to: z.string(),
  count: z.number(),
  head: z.string(),
  generated_at: z.string(),
  decisions: z.array(decisionSchema),
  chain: z.array(chainSchema),
  signature: z.string(),
})

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = exportSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Not a Sanction audit export", details: parsed.error.flatten() }, { status: 400 })
  }
  const doc = parsed.data as AuditExport

  const owner = await authenticateOwner(req, doc.wallet_id)
  if (!owner.wallet) {
    return NextResponse.json({ error: "Unauthorized: management key required" }, { status: 401 })
  }

  const secret = process.env.SANCTION_SIGNING_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Signing not configured" }, { status: 503 })
  }

  const result = verifyExport(doc, secret)
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
}
