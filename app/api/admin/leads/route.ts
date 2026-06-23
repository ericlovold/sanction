import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Export captured marketing leads. Owner-only, guarded by the deployment's
 * SANCTION_ADMIN_SECRET (x-admin-secret header). CSV by default; ?format=json
 * for JSON. The list is ours — this is how you pull it for a broadcast/import.
 */
export async function GET(req: NextRequest) {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  if (!constantTimeEqual(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }

  const leads = await db.lead.findMany({
    select: { email: true, source: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({ count: leads.length, leads }, { headers: { "Cache-Control": "no-store" } })
  }

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = leads.map((l) => `${esc(l.email)},${esc(l.source ?? "")},${l.createdAt.toISOString()}`)
  const csv = ["email,source,created_at", ...rows].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads.csv"`,
      "Cache-Control": "no-store",
    },
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
