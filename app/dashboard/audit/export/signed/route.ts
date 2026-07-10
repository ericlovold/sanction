import { NextRequest, NextResponse } from "next/server"
import { getSessionWallet } from "@/lib/session"
import { rangeUtc } from "@/lib/reporting"
import { buildWalletExport } from "@/lib/auditExport"

// Cookie-authed signed evidence export for the dashboard (LOCAL-1 / AUDIT-1).
// Same document as GET /api/v1/audit/export — hash-chained + HMAC-signed — but
// gated on the SESSION wallet so a browser can download without an sk_ header.
// Demo view (no session) fails closed. Pure read.

export async function GET(req: NextRequest) {
  const wallet = await getSessionWallet()
  if (!wallet) return new NextResponse("Log in to download signed evidence.", { status: 401 })

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
  const { export: doc, truncated } = await buildWalletExport(
    wallet.id,
    from,
    to,
    start,
    end,
    secret,
    generatedAt,
  )

  return NextResponse.json(
    truncated
      ? { ...doc, truncated: true, note_truncated: `only the first ${doc.count} decisions in range were exported` }
      : doc,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="sanction-evidence-${wallet.id}-${from}_${to}.json"`,
      },
    },
  )
}
