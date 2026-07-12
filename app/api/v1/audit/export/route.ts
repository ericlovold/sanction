import { NextRequest, NextResponse } from "next/server"
import { authenticateOwner } from "@/lib/ownerAuth"
import { rangeUtc } from "@/lib/reporting"
import { buildWalletExport, euAiActFraming } from "@/lib/auditExport"
import { readScope, scopedWalletIds } from "@/lib/apiScope"

// Tamper-evident audit export (AUDIT-1). GET a signed, hash-chained snapshot of
// a wallet's governed decisions over a date range. Each decision is chained to
// the one before it and the head is HMAC-signed with the platform secret, so a
// recipient can prove — with POST /v1/audit/verify or any conforming verifier —
// that nothing in the export was altered, dropped, or reordered after signing.
// Owner-only: audit evidence is a management-plane artifact. Pure read — nothing
// is persisted. The signing/chaining lives in lib/auditChain.ts.

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    return NextResponse.json({ error: "Unauthorized: management key required" }, { status: 401 })
  }

  const secret = process.env.SANCTION_SIGNING_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Signing not configured" }, { status: 503 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from = req.nextUrl.searchParams.get("from") ?? monthAgo
  const to = req.nextUrl.searchParams.get("to") ?? today
  let start: Date, end: Date
  try {
    ;({ start, end } = rangeUtc(from, to))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid range" }, { status: 400 })
  }

  const generatedAt = new Date().toISOString()
  // Owner is already authenticated on walletId; ?scope=subtree chains the whole
  // subtree's decisions into one signed export.
  const { walletIds } = await scopedWalletIds(walletId, readScope(req))
  const { export: doc, truncated } = await buildWalletExport(walletId, from, to, start, end, secret, generatedAt, walletIds)

  // ?framing=eu-ai-act attaches a descriptive block mapping this signed export
  // onto the Act's Art 12/13/14 obligations + retention. It rides alongside the
  // signed decisions/chain/signature (never alters them), so /audit/verify is
  // unaffected — the integrity proof and the framing are independent.
  const framed = req.nextUrl.searchParams.get("framing") === "eu-ai-act"
  const withFraming = framed ? { ...doc, ai_act: euAiActFraming(doc) } : doc

  const download = req.nextUrl.searchParams.get("download") === "1"
  const headers: Record<string, string> = { "Cache-Control": "no-store" }
  if (download) {
    const suffix = framed ? "-eu-ai-act" : ""
    headers["Content-Disposition"] = `attachment; filename="sanction-audit${suffix}-${walletId}-${from}_${to}.json"`
  }
  return NextResponse.json(truncated ? { ...withFraming, truncated: true, note_truncated: `only the first ${doc.count} decisions in range were exported` } : withFraming, { headers })
}
