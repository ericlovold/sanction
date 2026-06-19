import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto"

function getSigningKey() {
  const secret = process.env.SANCTION_SIGNING_SECRET
  if (!secret) throw new Error("SANCTION_SIGNING_SECRET not set")
  return new TextEncoder().encode(secret)
}

export interface SanctionClaims extends JWTPayload {
  wallet: string
  agent: string
  clearance: number
  scope: string[]
  budget_usd: number
}

export async function issueExecutionJWT(
  claims: Omit<SanctionClaims, "iss" | "iat">,
  ttlSeconds = 900,
): Promise<{ jwt: string; jti: string }> {
  // The jti IS the execution-token id. The caller persists a row with this exact
  // id, and inject() looks the token up by the jti carried in the JWT — they
  // must be the same value or injection can never find the token.
  const jti = randomBytes(16).toString("hex")
  const jwt = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sanction")
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(jti)
    .sign(getSigningKey())
  return { jwt, jti }
}

export async function verifyExecutionJWT(token: string): Promise<SanctionClaims & { jti: string }> {
  // Pin the algorithm explicitly: never let a token's own header pick the
  // verification alg (defends against alg-confusion / "alg: none").
  const { payload } = await jwtVerify(token, getSigningKey(), {
    issuer: "sanction",
    algorithms: ["HS256"],
  })
  return payload as SanctionClaims & { jti: string }
}

// AES-256-GCM encryption for credential values at rest
function getEncryptionKey(): Buffer {
  const key = process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error("SANCTION_CREDENTIAL_ENCRYPTION_KEY not set")
  return createHash("sha256").update(key).digest()
}

// Ciphertext format version. v1 binds Additional Authenticated Data (AAD) so a
// blob can't be silently moved to a different wallet/label/version. Legacy blobs
// (pre-versioning) have no leading version byte and are decrypted on a fallback
// path; they upgrade to v1 the next time they're written.
const CIPHERTEXT_V1 = 0x01

/**
 * Encrypt a credential value with AES-256-GCM.
 *
 * @param plaintext the secret value
 * @param aad context the ciphertext is cryptographically bound to — pass a
 *   stable per-credential string (e.g. `${walletId}:${label}`). Decryption with
 *   a different AAD fails the GCM tag check, so a stolen blob can't be replayed
 *   under another tenant/label.
 */
export function encryptCredential(plaintext: string, aad?: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"))
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([CIPHERTEXT_V1]), iv, tag, encrypted]).toString("base64")
}

export function decryptCredential(ciphertext: string, aad?: string): string {
  const buf = Buffer.from(ciphertext, "base64")

  // v1: leading version byte + AAD binding.
  if (buf[0] === CIPHERTEXT_V1) {
    try {
      return decryptV1(buf, aad)
    } catch {
      // Fall through: a legacy blob could coincidentally start with 0x01.
    }
  }
  return decryptLegacy(buf)
}

function decryptV1(buf: Buffer, aad?: string): string {
  const iv = buf.subarray(1, 13)
  const tag = buf.subarray(13, 29)
  const encrypted = buf.subarray(29)
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv)
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}

// Pre-versioning layout: iv(12) ‖ tag(16) ‖ ciphertext, no AAD.
function decryptLegacy(buf: Buffer): string {
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}
