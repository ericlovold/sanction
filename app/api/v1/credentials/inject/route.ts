import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { verifyExecutionJWT } from "@/lib/jwt"
import { decryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { decideCredential } from "@/lib/credentialDecisions"

const schema = z.object({
  credential_label: z.string(),
})

// Called by agent/container at runtime — present JWT, get decrypted credential for this scope only
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Bearer JWT required" }, { status: 401 })
  }

  const token = authHeader.slice(7)
  let claims
  try {
    // Partial verify first (no aud yet — we need claims.wallet to enforce aud).
    // Full audience check happens below once we have the walletId from the DB.
    claims = await verifyExecutionJWT(token)
  } catch {
    return NextResponse.json({ error: "Invalid or expired JWT" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { credential_label } = parsed.data

  // Verify the label is in the JWT's scope
  if (!claims.scope.includes(credential_label)) {
    return NextResponse.json({ error: `'${credential_label}' not in JWT scope` }, { status: 403 })
  }

  // SEC-5: verify JWT audience matches the wallet claimed in the token body.
  // We already have claims.wallet from the initial verify; now enforce it.
  try {
    await verifyExecutionJWT(token, claims.wallet)
  } catch {
    return NextResponse.json({ error: "JWT audience mismatch" }, { status: 401 })
  }

  // Check execution token is still active and not expired
  const execToken = await db.executionToken.findUnique({ where: { id: claims.jti } })
  if (!execToken || execToken.status !== "active" || execToken.expiresAt < new Date()) {
    return NextResponse.json({ error: "Execution token expired or revoked" }, { status: 401 })
  }

  // Fetch and decrypt the credential — scope the query to the wallet from the
  // JWT so a token forged with a different wallet claim can never reach another
  // tenant's credentials (defence-in-depth on top of the aud check above).
  const credential = await db.credentialVault.findFirst({
    where: { walletId: claims.wallet, label: credential_label },
  })
  if (!credential) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 })
  }

  // The credential's own access policy (revoked / expired / clearance) is decided
  // by the shared engine (ADR-0009 M4 — credential.use). Token-layer auth above
  // (JWT, audience, execution-token status, scope) stays at the token boundary.
  const decision = decideCredential({
    clearance: claims.clearance ?? 1,
    minClearance: credential.minClearance,
    revoked: !!credential.revokedAt,
    expired: !!(credential.expiresAt && credential.expiresAt < new Date()),
  })
  if (decision.effect === "deny") {
    return NextResponse.json({ error: decision.reason }, { status: decision.status })
  }

  // Permitted — honor the obligations: audit_log (record the access; raw value
  // never logged) and no_store (set on the response below).
  await db.credentialInjection.create({
    data: { executionTokenId: execToken.id, credentialId: credential.id },
  })

  const value = await decryptCredentialEnvelope(credential)

  return NextResponse.json(
    {
      label: credential.label,
      type: credential.type,
      value,
      injected_at: new Date().toISOString(),
      expires_at: execToken.expiresAt.toISOString(),
    },
    // Never let a decrypted secret sit in any shared/proxy/browser cache (SEC-13).
    { headers: { "Cache-Control": "no-store" } },
  )
}
