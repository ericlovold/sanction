import { createHash, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { cleanupExpiredRecords } from "@/lib/cleanup"

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

// Same bearer authentication as the digest cron. An unset secret fails closed.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const given = createHash("sha256").update(req.headers.get("authorization") ?? "").digest()
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest()
  if (!secret || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE })
  }

  try {
    const result = await cleanupExpiredRecords()
    console.info("expired-record cleanup completed", result)
    return NextResponse.json(result, { status: result.failed.length ? 500 : 200, headers: NO_STORE })
  } catch (error) {
    console.error("expired-record cleanup failed", error)
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500, headers: NO_STORE })
  }
}
