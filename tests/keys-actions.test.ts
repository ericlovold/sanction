import { describe, it, expect, vi, beforeEach } from "vitest"

// Self-serve reset of the master management key (sk_) from the dashboard. The
// session proves ownership, so no old key is required — the "I lost my admin
// key" recovery. The old key dies on write; the session is re-set to the new one.
const { dbMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { wallet: { update: vi.fn() }, agent: { findUnique: vi.fn(), update: vi.fn() }, agentClearance: { upsert: vi.fn() } },
  sessionMock: { getSessionWallet: vi.fn(), setSession: vi.fn(async () => {}) },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/rls", () => ({ withTenant: (_w: string, fn: (tx: typeof dbMock) => unknown) => fn(dbMock) }))
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { resetManagementKeyAction } from "../app/dashboard/keys/actions"

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.update.mockResolvedValue({})
})

describe("resetManagementKeyAction", () => {
  it("refuses without a session and never touches the key", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())
    expect(res.ok).toBe(false)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(sessionMock.setSession).not.toHaveBeenCalled()
  })

  it("mints a fresh sk_ key, stores only its hash, and re-sets the session to it", async () => {
    sessionMock.getSessionWallet.mockResolvedValue({ id: "wallet_1" })
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())

    expect(res.ok).toBe(true)
    expect(res.newKey).toMatch(/^sk_[0-9a-f]{64}$/)

    // Persisted the new hash/prefix for wallet_1 — never the raw key.
    const data = dbMock.wallet.update.mock.calls[0][0].data
    expect(dbMock.wallet.update.mock.calls[0][0].where).toEqual({ id: "wallet_1" })
    expect(data.mgmtKeyPrefix).toBe(res.newKey!.slice(0, 11))
    expect(data.mgmtKeyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(data)).not.toContain(res.newKey) // raw key is never stored

    // The current login survives the rotation.
    expect(sessionMock.setSession).toHaveBeenCalledWith(res.newKey)
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/team")
  })
})
