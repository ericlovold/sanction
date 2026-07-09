import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rateLimit"
import { authzenRespond } from "@/lib/authzen"

// Per-agent fixed-window limiter for the AuthZEN surface. These endpoints are
// authenticated, so the key is the agent — an agent behind a NAT can't starve
// its neighbors, and a leaked key can't hide behind rotating IPs. The batch
// endpoint amplifies (50 items ≈ 150 DB queries per request), so callers pass
// a per-endpoint budget. Returns the 429 to send, or null to proceed.

const WINDOW_SECONDS = 60

export async function authzenRateLimit(
  req: NextRequest,
  bucket: string,
  agentId: string,
  perMinute: number,
): Promise<NextResponse | null> {
  const result = await rateLimit(bucket, agentId, perMinute, WINDOW_SECONDS)
  if (result.ok) return null
  const res = authzenRespond(
    req,
    { error: `Rate limit exceeded (${result.limit}/min) — retry after ${result.retryAfter}s` },
    429,
  )
  res.headers.set("Retry-After", String(result.retryAfter ?? WINDOW_SECONDS))
  return res
}
