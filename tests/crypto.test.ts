import { describe, it, expect, beforeAll } from "vitest"
import { createCipheriv, createHash, randomBytes } from "crypto"
import { encryptCredential, decryptCredential, issueExecutionJWT, verifyExecutionJWT } from "../lib/jwt"
import { generateApiKey, generateManagementKey, hashApiKey } from "../lib/apiKey"

beforeAll(() => {
  process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-material"
  process.env.SANCTION_SIGNING_SECRET = "test-signing-secret-material"
})

// Mirrors the v1 encryption key derivation so we can forge a legacy blob.
function legacyKey() {
  return createHash("sha256").update(process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY!).digest()
}

describe("credential encryption (AES-256-GCM)", () => {
  it("round-trips with AAD binding", () => {
    const blob = encryptCredential("s3cret-value", "wallet_1:openai")
    expect(decryptCredential(blob, "wallet_1:openai")).toBe("s3cret-value")
  })

  it("round-trips without AAD", () => {
    const blob = encryptCredential("plain")
    expect(decryptCredential(blob)).toBe("plain")
  })

  it("writes the v1 version byte", () => {
    const blob = encryptCredential("x", "a:b")
    expect(Buffer.from(blob, "base64")[0]).toBe(0x01)
  })

  it("rejects a mismatched AAD (wrong wallet/label)", () => {
    const blob = encryptCredential("s3cret", "wallet_1:openai")
    expect(() => decryptCredential(blob, "wallet_2:openai")).toThrow()
  })

  it("rejects a tampered ciphertext", () => {
    const buf = Buffer.from(encryptCredential("s3cret", "a:b"), "base64")
    buf[buf.length - 1] ^= 0xff
    expect(() => decryptCredential(buf.toString("base64"), "a:b")).toThrow()
  })

  it("produces a unique nonce per call (no reuse)", () => {
    const a = Buffer.from(encryptCredential("same", "a:b"), "base64").subarray(1, 13)
    const b = Buffer.from(encryptCredential("same", "a:b"), "base64").subarray(1, 13)
    expect(a.equals(b)).toBe(false)
  })

  it("decrypts a legacy (pre-versioning, no-AAD) blob", () => {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", legacyKey(), iv)
    const enc = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    const legacyBlob = Buffer.concat([iv, tag, enc]).toString("base64")
    expect(decryptCredential(legacyBlob)).toBe("legacy-secret")
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
    const jwt = await issueExecutionJWT(claims)
    const v = await verifyExecutionJWT(jwt)
    expect(v.wallet).toBe("w1")
    expect(v.scope).toEqual(["openai"])
    expect(v.jti).toMatch(/^[0-9a-f]{32}$/)
  })

  it("rejects a tampered token", async () => {
    const jwt = await issueExecutionJWT(claims)
    const tampered = jwt.slice(0, -2) + (jwt.endsWith("a") ? "bb" : "aa")
    await expect(verifyExecutionJWT(tampered)).rejects.toThrow()
  })

  it("uses a caller-supplied jti so the JWT and its DB row share one id", async () => {
    // Regression: /exec writes the ExecutionToken row under a jti and /inject
    // looks it up by the JWT's jti — they MUST match or every inject 401s.
    const jwt = await issueExecutionJWT(claims, 900, "shared-jti-deadbeef")
    const v = await verifyExecutionJWT(jwt)
    expect(v.jti).toBe("shared-jti-deadbeef")
  })
})
