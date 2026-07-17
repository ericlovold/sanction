import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: credentials/actions.ts mutations now sit
// behind requireSessionRole("admin") instead of the bare getSessionWallet —
// a viewer resolves to the same null as no session, same denial.
const { dbMock, sessionMock, cryptoMock, rlsMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { credentialVault: { create: vi.fn() } },
  sessionMock: { requireSessionRole: vi.fn() },
  cryptoMock: { encryptCredentialEnvelope: vi.fn(async () => ({ blob: "enc", keyId: "key_1" })) },
  rlsMock: { withTenant: vi.fn((_walletId: string, fn: (tx: typeof dbMock) => unknown) => fn(dbMock)) },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/credentialCrypto", () => cryptoMock)
vi.mock("@/lib/rls", () => rlsMock)
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { createCredentialAction } from "../app/dashboard/credentials/actions"

const WALLET = { id: "wallet_1" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

const VALID = { label: "OpenAI prod key", type: "api_key", value: "sk-live-x", min_clearance: "2" }

beforeEach(() => vi.clearAllMocks())

describe("createCredentialAction — role floor", () => {
  it("denies without encrypting or writing when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    await createCredentialAction(form(VALID))
    expect(cryptoMock.encryptCredentialEnvelope).not.toHaveBeenCalled()
    expect(dbMock.credentialVault.create).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and writes once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    await createCredentialAction(form(VALID))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(dbMock.credentialVault.create).toHaveBeenCalledOnce()
  })
})
