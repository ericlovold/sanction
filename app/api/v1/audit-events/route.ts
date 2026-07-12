import { NextRequest, NextResponse } from "next/server"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"
import { toCsv } from "@/lib/reporting"
import { buildAuditFeed } from "@/lib/auditFeed"
import { readScope, scopedWalletIds } from "@/lib/apiScope"

// Unified, time-sorted audit feed for a wallet: spend decisions, token usage, and
// credential injections (secret access). The "what did my agents do?" surface —
// a read model over the distributed audit tables (AuthorizationRequest, TokenLog,
// CredentialInjection). Readable by the wallet owner (x-mgmt-key) or any active
// agent in the wallet (x-api-key) — same membership check as /wallets/stats.
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    const { agent } = await authenticateAgent(req)
    if (!agent || agent.walletId !== walletId) {
      return NextResponse.json({ error: "Unauthorized: management key or wallet agent key required" }, { status: 401 })
    }
  }

  const type = req.nextUrl.searchParams.get("type") // authorization | token | injection
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 200)
  const beforeParam = req.nextUrl.searchParams.get("before")
  const before = beforeParam ? new Date(beforeParam) : undefined
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 })
  }

  // Owner-only subtree widening; an agent key stays scoped to its own wallet.
  const scope = owner.wallet ? readScope(req) : "wallet"
  const { walletIds } = await scopedWalletIds(walletId, scope)
  const { events, next_before } = await buildAuditFeed(walletIds, { type, limit, before })

  // CSV export (REPORT-1): the same page of the same feed, spreadsheet-ready.
  // Paginate with `before` exactly like the JSON shape.
  if (req.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(events), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sanction-audit-${walletId}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }

  return NextResponse.json({ wallet_id: walletId, scope, events, next_before }, { headers: { "Cache-Control": "no-store" } })
}
