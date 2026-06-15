import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { verifyExecutionJWT } from "@/lib/jwt"
import { decryptCredential } from "@/lib/jwt"

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

  // Check execution token is still active and not expired
  const execToken = await db.executionToken.findUnique({ where: { id: claims.jti } })
  if (!execToken || execToken.status !== "active" || execToken.expiresAt < new Date()) {
    return NextResponse.json({ error: "Execution token expired or revoked" }, { status: 401 })
  }

  // Fetch and decrypt the credential
  const credential = await db.credentialVault.findFirst({
    where: { walletId: claims.wallet, label: credential_label },
  })
  if (!credential) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 })
  }

  // Reject expired credentials — a rotated/expired secret must not be injectable.
  if (credential.expiresAt && credential.expiresAt < new Date()) {
    return NextResponse.json({ error: "Credential has expired" }, { status: 410 })
  }

  // Audit the injection
  await db.credentialInjection.create({
    data: { executionTokenId: execToken.id, credentialId: credential.id },
  })

  const value = decryptCredential(credential.encryptedValue)

  return NextResponse.json({
    label: credential.label,
    type: credential.type,
    value,
    injected_at: new Date().toISOString(),
    expires_at: execToken.expiresAt.toISOString(),
  })
}
