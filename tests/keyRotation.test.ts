import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    walletKey: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    credentialVault: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// Real RLS needs Postgres; here withTenant just hands back the mocked client.
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))

import { encryptCredentialEnvelope, decryptCredentialEnvelope, rotateWalletKey, encryptV3 } from "../lib/credentialCrypto"
import { generateDataKey } from "../lib/kms"

const WALLET = "wallet_rot"
const LABEL = "openai"

beforeAll(() => {
  process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

describe("rotateWalletKey", () => {
  it("retires the active key and mints a new one atomically", async () => {
    dbMock.walletKey.updateMany.mockResolvedValue({ count: 1 })
    dbMock.walletKey.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "wk_new",
      ...data,
      isActive: true,
    }))

    const out = await rotateWalletKey(WALLET)

    expect(out.keyId).toBe("wk_new")
    expect(out.retiredPrevious).toBe(1)
    expect(dbMock.walletKey.updateMany).toHaveBeenCalledWith({
      where: { walletId: WALLET, isActive: true },
      data: { isActive: false, retiredAt: expect.any(Date) },
    })
  })

  it("adopts the winner's key when a concurrent rotation takes the race", async () => {
    dbMock.walletKey.updateMany.mockResolvedValue({ count: 1 })
    dbMock.walletKey.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }))
    dbMock.walletKey.findFirst.mockResolvedValue({ id: "wk_winner", keyRef: "local", isActive: true })

    const out = await rotateWalletKey(WALLET)

    expect(out.keyId).toBe("wk_winner")
    expect(out.retiredPrevious).toBe(0)
  })

  it("rethrows non-race failures", async () => {
    dbMock.walletKey.updateMany.mockResolvedValue({ count: 1 })
    dbMock.walletKey.create.mockRejectedValue(new Error("connection lost"))
    await expect(rotateWalletKey(WALLET)).rejects.toThrow("connection lost")
  })
})

describe("rotation end-to-end over the envelope", () => {
  it("old blobs still decrypt via the retired key row, and lazily re-wrap to the active key", async () => {
    // Mint a "retired" key with a real local-wrapped DEK, and encrypt a blob under it.
    const oldGen = await generateDataKey()
    const oldBlob = encryptV3("s3cret", oldGen.plaintextDek, WALLET, LABEL)
    const retiredRow = { id: "wk_old", walletId: WALLET, wrappedDek: oldGen.wrappedDek, keyRef: "local", isActive: false }

    // decrypt path resolves the credential's key by id (retired), then re-wraps
    // under the active key (resolved via findFirst).
    dbMock.walletKey.findUnique.mockResolvedValue(retiredRow)
    dbMock.walletKey.findFirst.mockResolvedValue(null) // no active yet → getWalletDek mints one
    dbMock.walletKey.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "wk_active",
      ...data,
      isActive: true,
    }))
    dbMock.credentialVault.updateMany.mockResolvedValue({ count: 1 })

    const plaintext = await decryptCredentialEnvelope({
      id: "cred_1",
      encryptedValue: oldBlob,
      walletId: WALLET,
      label: LABEL,
      keyId: "wk_old",
    })

    expect(plaintext).toBe("s3cret")
    // Re-wrap wrote a new blob under the new keyId, guarded on the old keyId.
    expect(dbMock.credentialVault.updateMany).toHaveBeenCalledTimes(1)
    const call = dbMock.credentialVault.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: "cred_1", keyId: "wk_old" })
    expect(call.data.keyId).toBe("wk_active")
    expect(call.data.encryptedValue).not.toBe(oldBlob)
  })

  it("does not re-wrap when the credential's key is still active", async () => {
    const gen = await generateDataKey()
    const blob = encryptV3("s3cret", gen.plaintextDek, WALLET, LABEL)
    dbMock.walletKey.findUnique.mockResolvedValue({
      id: "wk_live",
      walletId: WALLET,
      wrappedDek: gen.wrappedDek,
      keyRef: "local",
      isActive: true,
    })

    const plaintext = await decryptCredentialEnvelope({
      id: "cred_1",
      encryptedValue: blob,
      walletId: WALLET,
      label: LABEL,
      keyId: "wk_live",
    })

    expect(plaintext).toBe("s3cret")
    expect(dbMock.credentialVault.updateMany).not.toHaveBeenCalled()
  })

  it("re-wrap failure never blocks the decrypt", async () => {
    const oldGen = await generateDataKey()
    const oldBlob = encryptV3("s3cret", oldGen.plaintextDek, WALLET, LABEL)
    dbMock.walletKey.findUnique.mockResolvedValue({
      id: "wk_old2",
      walletId: WALLET,
      wrappedDek: oldGen.wrappedDek,
      keyRef: "local",
      isActive: false,
    })
    dbMock.walletKey.findFirst.mockRejectedValue(new Error("db down"))

    await expect(
      decryptCredentialEnvelope({ id: "cred_1", encryptedValue: oldBlob, walletId: WALLET, label: LABEL, keyId: "wk_old2" }),
    ).resolves.toBe("s3cret")
  })

  it("writes under the active key after rotation", async () => {
    const gen = await generateDataKey()
    dbMock.walletKey.findFirst.mockResolvedValue({
      id: "wk_active2",
      walletId: WALLET,
      wrappedDek: gen.wrappedDek,
      keyRef: "local",
      isActive: true,
    })

    const out = await encryptCredentialEnvelope("fresh-secret", WALLET, "stripe")
    expect(out.keyId).toBe("wk_active2")
  })
})
