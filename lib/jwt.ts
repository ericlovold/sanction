import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto"

function getSigningKey() {
  const secret = process.env.AUTOFLUX_SIGNING_SECRET
  if (!secret) throw new Error("AUTOFLUX_SIGNING_SECRET not set")
  return new TextEncoder().encode(secret)
}

export interface AutoFluxClaims extends JWTPayload {
  wallet: string
  agent: string
  clearance: number
  scope: string[]
  budget_usd: number
}

export async function issueExecutionJWT(claims: Omit<AutoFluxClaims, "iss" | "iat">, ttlSeconds = 900): Promise<string> {
  const jti = randomBytes(16).toString("hex")
  return new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("autoflux")
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(jti)
    .sign(getSigningKey())
}

export async function verifyExecutionJWT(token: string): Promise<AutoFluxClaims & { jti: string }> {
  const { payload } = await jwtVerify(token, getSigningKey(), { issuer: "autoflux" })
  return payload as AutoFluxClaims & { jti: string }
}

// AES-256-GCM encryption for credential values at rest
function getEncryptionKey(): Buffer {
  const key = process.env.AUTOFLUX_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error("AUTOFLUX_CREDENTIAL_ENCRYPTION_KEY not set")
  return createHash("sha256").update(key).digest()
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decryptCredential(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf8")
}
