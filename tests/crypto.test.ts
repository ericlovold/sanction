import { describe, it, expect, beforeAll } from "vitest"
import { createCipheriv, createHash, randomBytes } from "crypto"
import { encryptCredential, decryptCredential, issueExecutionJWT, verifyExecutionJWT } from "../lib/jwt"
import { generateApiKey, generateManagementKey, hashApiKey } from "../lib/apiKey"

const WALLET = "wallet_1"
const LABEL = "openai"

beforeAll(() => {
  process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-material"
  process.env.SANCTION_SIGNING_SECRET = "test-signing-secret-material"
})

// Mirrors the legacy (V0) encryption key derivation so we can forge a legacy blob.
function legacyKey() {
  return createHash("sha256").update(process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY!).digest()
}

describe("credential encryption (AES-256-GCM)", () => {
  it("round-trips with per-wallet HKDF key (V2)", () => {
    const blob = encryptCredential("s3cret-value", WALLET, LABEL)
    expect(decryptCredential(blob, WALLET, LABEL)).toBe("s3cret-value")
  })

  it("writes the V2 version byte", () => {
    const blob = encryptCredential("x", "a", "b")
    expect(Buffer.from(blob, "base64")[0]).toBe(0x02)
  })

  it("rejects a mismatched wallet (cross-tenant replay)", () => {
    const blob = encryptCredential("s3cret", WALLET, LABEL)
    expect(() => decryptCredential(blob, "wallet_2", LABEL)).toThrow()
  })

  it("rejects a mismatched label (within-tenant replay)", () => {
    const blob = encryptCredential("s3cret", WALLET, LABEL)
    expect(() => decryptCredential(blob, WALLET, "stripe")).toThrow()
  })

  it("rejects a tampered ciphertext", () => {
    const buf = Buffer.from(encryptCredential("s3cret", WALLET, LABEL), "base64")
    buf[buf.length - 1] ^= 0xff
    expect(() => decryptCredential(buf.toString("base64"), WALLET, LABEL)).toThrow()
  })

  it("produces a unique nonce per call (no nonce reuse)", () => {
    const a = Buffer.from(encryptCredential("same", WALLET, LABEL), "base64").subarray(1, 13)
    const b = Buffer.from(encryptCredential("same", WALLET, LABEL), "base64").subarray(1, 13)
    expect(a.equals(b)).toBe(false)
  })

  it("decrypts a legacy (V0, no-AAD) blob via fallback path", () => {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", legacyKey(), iv)
    const enc = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    const legacyBlob = Buffer.concat([iv, tag, enc]).toString("base64")
    // walletId/label are passed but unused for V0 blobs (no AAD, legacy key path)
    expect(decryptCredential(legacyBlob, WALLET, LABEL)).toBe("legacy-secret")
  })
})

describe("api keys", () => {
  it("generates a pxy_ agent key whose hash matches hashApiKey", () => {
    const { raw, hash, prefix } = generateApiKey()
    expect(raw.startsWith("pxy_")).toBe(true)
    expect(prefix).toBe(raw.slice(0, 12))
    expect(hashApiKey(raw)).toBe(hash)
  })

  it("generates an sk_ management key", () => {
    const { raw, prefix } = generateManagementKey()
    expect(raw.startsWith("sk_")).toBe(true)
    expect(prefix).toBe(raw.slice(0, 11))
  })
})

describe("execution JWT", () => {
  const claims = { wallet: "w1", agent: "a1", clearance: 3, scope: ["openai"], budget_usd: 5 }

  it("issues and verifies, preserving claims + jti", async () => {
    const { jwt, jti } = await issueExecutionJWT(claims)
    const v = await verifyExecutionJWT(jwt, "w1")
    expect(v.wallet).toBe("w1")
    expect(v.scope).toEqual(["openai"])
    expect(v.jti).toMatch(/^[0-9a-f]{32}$/)
    expect(v.jti).toBe(jti)
  })

  it("rejects a token presented to the wrong wallet (aud mismatch)", async () => {
    const { jwt } = await issueExecutionJWT(claims)
    await expect(verifyExecutionJWT(jwt, "wallet_attacker")).rejects.toThrow()
  })

  it("rejects a tampered token", async () => {
    const { jwt } = await issueExecutionJWT(claims)
    const tampered = jwt.slice(0, -2) + (jwt.endsWith("a") ? "bb" : "aa")
    await expect(verifyExecutionJWT(tampered, "w1")).rejects.toThrow()
  })
})
