import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { walletFreezeState } from "@/lib/freeze"
import { expiredExecutionClaims, verifyExecutionJWT } from "@/lib/jwt"
import { bindMandateRow, evaluateMandate, MANDATE_INVALID } from "@/lib/mandate"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { withTenant } from "@/lib/rls"

// WALLET-1: a counterparty who was handed an execution JWT can check whether
// that mandate is still live — without a Sanction API key. HS256 is not
// locally verifiable; this endpoint is the merchant-side auth. The JWT is the
// capability; garbage / unknown tokens fail closed as invalid, never 401.

const schema = z.object({
  mandate: z.string().min(1),
})

const NO_STORE = { "Cache-Control": "no-store" } as const

export async function POST(req: NextRequest) {
  const rl = await rateLimit("mandate_verify", clientIp(req), 60, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60), ...NO_STORE } },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "mandate is required" }, { status: 400, headers: NO_STORE })
  }

  let claims: Awaited<ReturnType<typeof verifyExecutionJWT>>
  let jwtExpired = false
  try {
    claims = await verifyExecutionJWT(parsed.data.mandate)
  } catch (err) {
    const expired = expiredExecutionClaims(err)
    if (!expired) return NextResponse.json(MANDATE_INVALID, { headers: NO_STORE })
    claims = expired
    jwtExpired = true
  }

  const row = await withTenant(claims.wallet, (tx) =>
    tx.executionToken.findUnique({ where: { id: claims.jti } }),
  )
  const token = bindMandateRow(row, { jti: claims.jti, wallet: claims.wallet, agent: claims.agent })
  const freeze = token ? await walletFreezeState(db, token.walletId) : { frozen: false as const }
  // If the JWT is past exp, name it expired even when the row's expiresAt still
  // looks live (clock skew between jose exp and the stored TTL).
  const now = jwtExpired && token ? new Date(Math.max(Date.now(), token.expiresAt.getTime())) : undefined

  return NextResponse.json(evaluateMandate({ token, freezeFrozen: freeze.frozen, now }), { headers: NO_STORE })
}
