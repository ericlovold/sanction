import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { createHash, randomBytes, createCipheriv, createDecipheriv, hkdfSync } from "crypto"

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
  // jti IS the execution-token DB id — they must match or inject() can never
  // find the token.
  const jti = randomBytes(16).toString("hex")
  const jwt = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sanction")
    // SEC-5: bind the token to the issuing wallet so it cannot be replayed
    // against a different wallet's inject endpoint.
    .setAudience([claims.wallet as string])
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(jti)
    .sign(getSigningKey())
  return { jwt, jti }
}

export async function verifyExecutionJWT(
  token: string,
  expectedWalletId?: string,
): Promise<SanctionClaims & { jti: string }> {
  // Pin alg to block alg-confusion / "alg: none" attacks.
  // If the caller supplies expectedWalletId, jose enforces aud === walletId.
  const { payload } = await jwtVerify(token, getSigningKey(), {
    issuer: "sanction",
    algorithms: ["HS256"],
    ...(expectedWalletId ? { audience: expectedWalletId } : {}),
  })
  return payload as SanctionClaims & { jti: string }
}

// ── Credential encryption (AES-256-GCM) ──────────────────────────────────────
//
// Ciphertext version history:
//   V0 (legacy) — no version byte; IV(12) ‖ tag(16) ‖ ct; global key; no AAD
//   V1           — 0x01 prefix;   IV(12) ‖ tag(16) ‖ ct; global key; AAD=walletId:label
//   V2           — 0x02 prefix;   IV(12) ‖ tag(16) ‖ ct; per-wallet HKDF key; AAD=walletId:label
//
// All new writes use V2. Reads fall through V2 → V1 → V0 for backward
// compatibility. Credentials upgrade to V2 the next time they are written.
//
// SEC-1: V2 derives a 256-bit per-wallet key via HKDF-SHA256 from the master
// key, using the walletId as salt. Compromising one wallet's derived key
// (e.g. via a GCM nonce reuse on that wallet) cannot help an attacker decrypt
// a different wallet's ciphertexts.

const CIPHERTEXT_V1 = 0x01
const CIPHERTEXT_V2 = 0x02

function getMasterKey(): Buffer {
  const key = process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error("SANCTION_CREDENTIAL_ENCRYPTION_KEY not set")
  return createHash("sha256").update(key).digest()
}

function deriveWalletKey(walletId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", getMasterKey(), Buffer.from(walletId, "utf8"), "sanction-dek-v2", 32),
  )
}

/**
 * Encrypt a credential with AES-256-GCM using a per-wallet HKDF-derived key.
 *
 * The ciphertext is cryptographically bound to its wallet+label (AAD), so a
 * stolen blob cannot be replayed under a different tenant or label.
 */
export function encryptCredential(plaintext: string, walletId: string, label: string): string {
  const aad = Buffer.from(`${walletId}:${label}`, "utf8")
  const key = deriveWalletKey(walletId)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([CIPHERTEXT_V2]), iv, tag, encrypted]).toString("base64")
}

export function decryptCredential(ciphertext: string, walletId: string, label: string): string {
  const buf = Buffer.from(ciphertext, "base64")
  const aad = `${walletId}:${label}`

  if (buf[0] === CIPHERTEXT_V2) {
    try {
      return decryptV2(buf, walletId, aad)
    } catch {
      // Could be a legacy blob whose first byte happens to be 0x02 (~1 in 128
      // of V0 blobs start with a random IV byte that collides with a version
      // marker). GCM auth makes the wrong path fail loudly, so falling through
      // to the legacy attempt is safe — a tampered V2 blob fails both.
    }
  }
  if (buf[0] === CIPHERTEXT_V1) {
    try {
      return decryptV1(buf, aad)
    } catch {
      // Could be a legacy blob whose first byte happens to be 0x01.
    }
  }
  return decryptLegacy(buf)
}

function decryptV2(buf: Buffer, walletId: string, aad: string): string {
  const iv = buf.subarray(1, 13)
  const tag = buf.subarray(13, 29)
  const encrypted = buf.subarray(29)
  const decipher = createDecipheriv("aes-256-gcm", deriveWalletKey(walletId), iv)
  decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}

function decryptV1(buf: Buffer, aad: string): string {
  const iv = buf.subarray(1, 13)
  const tag = buf.subarray(13, 29)
  const encrypted = buf.subarray(29)
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), iv)
  decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}

function decryptLegacy(buf: Buffer): string {
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}
