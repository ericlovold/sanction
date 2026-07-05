import { NextRequest, NextResponse } from "next/server"
import { rateLimit, clientIp } from "@/lib/rateLimit"
import { POLICY_PACKS } from "@/lib/policyPacks"

// The pack catalog (PACK-1). Static curated content, so it's public — but
// public endpoints get the fixed-window rate limit like every other one.
export async function GET(req: NextRequest) {
  const rl = await rateLimit("policy_packs", clientIp(req), 60, 600)
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } })
  }
  return NextResponse.json(
    { packs: POLICY_PACKS },
    { headers: { "Cache-Control": "public, max-age=600" } },
  )
}
