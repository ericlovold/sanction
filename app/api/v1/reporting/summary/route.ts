import { NextRequest, NextResponse } from "next/server"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"
import { rangeUtc } from "@/lib/reporting"
import { buildPeriodSummary } from "@/lib/reportingSummary"

// Period reporting (REPORT-1): the daily summary's grown-up sibling — any
// range up to 92 days, day-by-day buckets, optional per-agent grouping.
// "This week vs last week" is two calls. Same membership auth as the other
// reporting surfaces: wallet owner or any of the wallet's agents.
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

  // Defaults: the last 7 days, today inclusive.
  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from = req.nextUrl.searchParams.get("from") ?? weekAgo
  const to = req.nextUrl.searchParams.get("to") ?? today
  let start: Date, end: Date
  try {
    ;({ start, end } = rangeUtc(from, to))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid range" }, { status: 400 })
  }
  const groupByAgent = req.nextUrl.searchParams.get("group_by") === "agent"

  const summary = await buildPeriodSummary(walletId, { start, end, groupByAgent })

  return NextResponse.json(
    { wallet_id: walletId, from, to, ...summary },
    { headers: { "Cache-Control": "no-store" } },
  )
}
