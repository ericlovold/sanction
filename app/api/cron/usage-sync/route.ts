import { createHash, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { dueConnections, syncConnection } from "@/lib/connectors/sync"

// Hourly pull of every connected AI tool (vercel.json). Cursor asks for at
// most one poll an hour, so hourly is both the floor and the ceiling.
export const maxDuration = 300

const NO_STORE = { "Cache-Control": "no-store" }
// Stop starting new pulls with a minute to spare; whatever is left is first
// in line next hour (least recently attempted goes first).
const BUDGET_MS = 240_000

// Same bearer authentication as the other crons. An unset secret fails closed.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const given = createHash("sha256").update(req.headers.get("authorization") ?? "").digest()
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest()
  if (!secret || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE })
  }

  const started = Date.now()
  const ids = await dueConnections()
  let synced = 0
  let failed = 0
  let deferred = 0
  // Sequential on purpose: one connection's slow provider must not multiply
  // into parallel load on the database, and each pull paces itself against
  // its own provider's rate limit.
  for (const id of ids) {
    if (Date.now() - started > BUDGET_MS) {
      deferred++
      continue
    }
    const result = await syncConnection(id, { trigger: "cron" })
    if (result.ok) synced++
    else failed++
  }
  // 200 even when some pulls failed: each failure is on its connection and in
  // UsageSyncRun, and one bad key must not read as a broken cron.
  return NextResponse.json({ connections: ids.length, synced, failed, deferred }, { headers: NO_STORE })
}
