import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mock the Prisma client used by lib/envelope.ts. We back TenantKey with an
// in-memory store so the envelope DEK lifecycle (create-on-first-write, reuse,
// lookup-by-keyId) can be exercised without a database.
// ---------------------------------------------------------------------------
type TenantKeyRow = {
  id: string
  walletId: string
  keyId: string
  wrappedDek: string
  rootKeyId: string
  isActive: boolean
  createdAt: Date
}

const store: TenantKeyRow[] = []

// envelope.ts reaches TenantKey through withTenant() → db.$transaction(), so the
// mock exposes the same in-memory-backed delegate on both `db` and its tx
// client. The factory is hoisted above all top-level consts, so it must build
// the delegate inline (referencing only the hoisted `store`, used lazily at call
// time inside async fns).
vi.mock("../lib/db", () => {
  const delegate = {
    findFirst: async ({ where }: { where: { walletId: string; isActive?: boolean } }) =>
      store.find(
        (r) =>
          r.walletId === where.walletId &&
          (where.isActive === undefined || r.isActive === where.isActive),
      ) ?? null,
    findUnique: async ({ where }: { where: { walletId_keyId: { walletId: string; keyId: string } } }) =>
      store.find(
        (r) =>
          r.walletId === where.walletId_keyId.walletId &&
          r.keyId === where.walletId_keyId.keyId,
      ) ?? null,
    create: async ({ data }: { data: Omit<TenantKeyRow, "id" | "createdAt"> }) => {
      if (store.some((r) => r.walletId === data.walletId && r.keyId === data.keyId)) {
        throw new Error("unique violation")
      }
      const row: TenantKeyRow = { id: "tk_" + store.length, createdAt: new Date(), ...data }
      store.push(row)
      return row
    },
  }
  return {
    db: {
      tenantKey: delegate,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ tenantKey: delegate, $executeRaw: async () => 1 }),
    },
  }
})

import {
  encryptCredentialValue,
  decryptCredentialValue,
  clearDekCache,
} from "../lib/envelope"
import { LocalKms, setKms, generateDek, DEK_BYTES } from "../lib/kms"
import { encryptCredential } from "../lib/jwt"
import { createCipheriv, createHash, randomBytes } from "crypto"

beforeAll(() => {
  process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-material"
  process.env.SANCTION_KMS_ROOT_KEY = "test-kms-root-key-material"
})

beforeEach(() => {
  store.length = 0
  clearDekCache()
  setKms(null) // reset to default LocalKms (picks up env)
})

describe("KMS DEK wrap/unwrap (LocalKms)", () => {
  it("round-trips a DEK with matching AAD", async () => {
    const kms = new LocalKms("root-material")
    const dek = generateDek()
    expect(dek.length).toBe(DEK_BYTES)
    const wrapped = await kms.wrapDek(dek, "dek:wallet_1:dek_a")
    const out = await kms.unwrapDek(wrapped, "dek:wallet_1:dek_a")
    expect(out.equals(dek)).toBe(true)
  })

  it("rejects unwrap under a different AAD (wrong wallet)", async () => {
    const kms = new LocalKms("root-material")
    const dek = generateDek()
    const wrapped = await kms.wrapDek(dek, "dek:wallet_1:dek_a")
    await expect(kms.unwrapDek(wrapped, "dek:wallet_2:dek_a")).rejects.toThrow()
  })

  it("rejects a wrapped DEK from a different root key", async () => {
    const a = new LocalKms("root-A")
    const b = new LocalKms("root-B")
    const wrapped = await a.wrapDek(generateDek(), "dek:w:k")
    await expect(b.unwrapDek(wrapped, "dek:w:k")).rejects.toThrow()
  })

  it("exposes a stable, non-secret rootKeyId fingerprint", () => {
    const a = new LocalKms("root-A")
    const b = new LocalKms("root-A")
    const c = new LocalKms("root-C")
    expect(a.rootKeyId).toBe(b.rootKeyId)
    expect(a.rootKeyId).not.toBe(c.rootKeyId)
    expect(a.rootKeyId.startsWith("local:")).toBe(true)
  })
})

describe("envelope encryption (v2, per-tenant DEK)", () => {
  it("round-trips a value, writing the v2 version byte", async () => {
    const { ciphertext, keyId } = await encryptCredentialValue("wallet_1", "openai", "s3cret")
    expect(Buffer.from(ciphertext, "base64")[0]).toBe(0x02)
    expect(keyId).toMatch(/^dek_/)
    const out = await decryptCredentialValue("wallet_1", "openai", ciphertext)
    expect(out).toBe("s3cret")
  })

  it("creates exactly one active DEK per wallet and reuses it", async () => {
    await encryptCredentialValue("wallet_1", "a", "x")
    await encryptCredentialValue("wallet_1", "b", "y")
    expect(store.filter((r) => r.walletId === "wallet_1").length).toBe(1)
  })

  it("isolates DEKs across tenants (different wrapped DEKs)", async () => {
    await encryptCredentialValue("wallet_1", "a", "x")
    await encryptCredentialValue("wallet_2", "a", "x")
    const w1 = store.find((r) => r.walletId === "wallet_1")!
    const w2 = store.find((r) => r.walletId === "wallet_2")!
    expect(w1.wrappedDek).not.toBe(w2.wrappedDek)
    expect(w1.keyId).not.toBe(w2.keyId)
  })

  it("rejects decryption under a mismatched AAD (wrong label)", async () => {
    const { ciphertext } = await encryptCredentialValue("wallet_1", "openai", "s3cret")
    await expect(decryptCredentialValue("wallet_1", "stripe", ciphertext)).rejects.toThrow()
  })

  it("rejects decryption under the wrong tenant DEK (wrong wallet)", async () => {
    // Encrypt for wallet_1, then attempt to decrypt as wallet_2. wallet_2 has a
    // different DEK and a different AAD — must fail, never silently cross tenants.
    const { ciphertext } = await encryptCredentialValue("wallet_1", "openai", "s3cret")
    await encryptCredentialValue("wallet_2", "seed", "z") // give wallet_2 a DEK
    await expect(decryptCredentialValue("wallet_2", "openai", ciphertext)).rejects.toThrow()
  })

  it("rejects a tampered v2 ciphertext", async () => {
    const { ciphertext } = await encryptCredentialValue("wallet_1", "openai", "s3cret")
    const buf = Buffer.from(ciphertext, "base64")
    buf[buf.length - 1] ^= 0xff
    await expect(
      decryptCredentialValue("wallet_1", "openai", buf.toString("base64")),
    ).rejects.toThrow()
  })

  it("survives a creation race (unique violation → re-read existing DEK)", async () => {
    // Pre-seed an active DEK as if a concurrent writer created it first, then
    // ensure encrypt reuses it rather than failing.
    const kms = new LocalKms()
    const dek = generateDek()
    const keyId = "dek_preexisting"
    store.push({
      id: "tk_seed",
      walletId: "wallet_race",
      keyId,
      wrappedDek: await kms.wrapDek(dek, `dek:wallet_race:${keyId}`),
      rootKeyId: kms.rootKeyId,
      isActive: true,
      createdAt: new Date(),
    })
    setKms(kms)
    const { keyId: usedKeyId } = await encryptCredentialValue("wallet_race", "x", "v")
    expect(usedKeyId).toBe(keyId)
    expect(store.filter((r) => r.walletId === "wallet_race").length).toBe(1)
  })
})

describe("backward compatibility (lazy upgrade path)", () => {
  it("decrypts a v1 (global-key, AAD-bound) blob via fallback", async () => {
    // v1 blobs are produced by lib/jwt.encryptCredential with the global key.
    const v1 = encryptCredential("legacy-v1-secret", "wallet_1:openai")
    expect(Buffer.from(v1, "base64")[0]).toBe(0x01)
    const out = await decryptCredentialValue("wallet_1", "openai", v1)
    expect(out).toBe("legacy-v1-secret")
  })

  it("decrypts an unversioned legacy blob via fallback", async () => {
    const key = createHash("sha256")
      .update(process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY!)
      .digest()
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const enc = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    const legacy = Buffer.concat([iv, tag, enc]).toString("base64")
    const out = await decryptCredentialValue("wallet_1", "anything", legacy)
    expect(out).toBe("legacy-secret")
  })

  it("upgrades to v2 on re-encrypt (new write is envelope, old still decrypts)", async () => {
    const v1 = encryptCredential("rotate-me", "wallet_1:openai")
    expect(await decryptCredentialValue("wallet_1", "openai", v1)).toBe("rotate-me")
    // Simulate the next write going through the envelope path.
    const { ciphertext } = await encryptCredentialValue("wallet_1", "openai", "rotate-me")
    expect(Buffer.from(ciphertext, "base64")[0]).toBe(0x02)
    expect(await decryptCredentialValue("wallet_1", "openai", ciphertext)).toBe("rotate-me")
  })
})
