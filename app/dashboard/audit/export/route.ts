import { NextRequest, NextResponse } from "next/server"
import { getSessionWallet } from "@/lib/session"
import { buildAuditFeed } from "@/lib/auditFeed"
import { toCsv } from "@/lib/reporting"

// Cookie-authed CSV export for the dashboard. A browser download can't send the
// x-mgmt-key header the REST audit route wants, so this route gates on the
// SESSION wallet instead (never the demo view) — the demo dashboard can't
// export a wallet's audit trail, it just gets a 401. Same feed as the page.
export async function GET(req: NextRequest) {
  const wallet = await getSessionWallet()
  if (!wallet) return new NextResponse("Log in to export the audit trail.", { status: 401 })

  const type = req.nextUrl.searchParams.get("type")
  const { events } = await buildAuditFeed(wallet.id, { type, limit: 200 })

  return new NextResponse(toCsv(events), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sanction-audit-${wallet.id}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
