import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { verifyExecutionJWT } from "@/lib/jwt"
import { decryptCredentialValue } from "@/lib/envelope"
import { withTenant } from "@/lib/tenantDb"

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

  // All tenant-scoped reads/writes run inside the wallet's RLS context (SEC-3):
  // the DB will only surface this wallet's execution token, credential, and
  // injection rows even if a query forgot to filter by walletId.
  const result = await withTenant(claims.wallet, async (tx) => {
    // Check execution token is still active and not expired. (Keyed by jti, but
    // RLS additionally guarantees it belongs to claims.wallet.)
    const execToken = await tx.executionToken.findUnique({ where: { id: claims.jti } })
    if (!execToken || execToken.status !== "active" || execToken.expiresAt < new Date()) {
      return { error: "Execution token expired or revoked", status: 401 as const }
    }

    // Fetch the credential
    const credential = await tx.credentialVault.findFirst({
      where: { walletId: claims.wallet, label: credential_label },
    })
    if (!credential) {
      return { error: "Credential not found", status: 404 as const }
    }

    // Reject expired credentials — a rotated/expired secret must not be injectable.
    if (credential.expiresAt && credential.expiresAt < new Date()) {
      return { error: "Credential has expired", status: 410 as const }
    }

    // Audit the injection
    await tx.credentialInjection.create({
      data: { executionTokenId: execToken.id, credentialId: credential.id },
    })

    return { credential, execToken }
  })

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { credential, execToken } = result

  // Decrypt outside the tx: unwrapping the tenant DEK may hit the KMS, which we
  // don't want holding a DB transaction open. Envelope (v2) and legacy (v1/
  // unversioned) blobs are both handled by decryptCredentialValue.
  const value = await decryptCredentialValue(
    credential.walletId,
    credential.label,
    credential.encryptedValue,
  )

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
