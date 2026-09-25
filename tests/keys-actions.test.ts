import { describe, it, expect, vi, beforeEach } from "vitest"

// Self-serve reset of the master management key (sk_) from the dashboard. The
// session proves ownership, so no old key is required — the "I lost my admin
// key" recovery. The old key dies on write; the session is re-set to the new one.
const { dbMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { wallet: { update: vi.fn() }, agent: { findUnique: vi.fn(), update: vi.fn() }, agentClearance: { upsert: vi.fn() } },
  sessionMock: { requireSessionRole: vi.fn(), setSession: vi.fn(async () => {}) },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/rls", () => ({ withTenant: (_w: string, fn: (tx: typeof dbMock) => unknown) => fn(dbMock) }))
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { resetManagementKeyAction, updateLimitsAction } from "../app/dashboard/keys/actions"
import { hasRole, type WalletRole } from "../lib/roles"

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.update.mockResolvedValue({})
})

describe("resetManagementKeyAction", () => {
  it("refuses without a session and never touches the key", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())
    expect(res.ok).toBe(false)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(sessionMock.setSession).not.toHaveBeenCalled()
  })

  // A viewer member also resolves to null here (WALLET-MEMBERS role floor —
  // lib/session.ts's requireSessionRole), so this is the same denial path as
  // no-session: the action can't tell, and doesn't need to.
  it("refuses a viewer member the same way as no session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())
    expect(res.ok).toBe(false)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  // The real floor semantics (lib/session.ts requireSessionRole → hasRole): an
  // admin member must be refused, because the sk_ it would mint signs in as
  // "owner" (getSessionMember's legacy-key branch).
  it("refuses an admin member — minting an sk_ would escalate admin to owner", async () => {
    const asRole = (role: WalletRole) => async (min: WalletRole) => (hasRole(role, min) ? { id: "wallet_1" } : null)
    sessionMock.requireSessionRole.mockImplementation(asRole("admin"))
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())
    expect(res.ok).toBe(false)
    expect(res.newKey).toBeUndefined()
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(sessionMock.setSession).not.toHaveBeenCalled()

    sessionMock.requireSessionRole.mockImplementation(asRole("owner"))
    expect((await resetManagementKeyAction({ ok: false, error: "" }, new FormData())).ok).toBe(true)
  })

  it("mints a fresh sk_ key, stores only its hash, and re-sets the session to it", async () => {
    sessionMock.requireSessionRole.mockResolvedValue({ id: "wallet_1" })
    const res = await resetManagementKeyAction({ ok: false, error: "" }, new FormData())

    expect(res.ok).toBe(true)
    expect(res.newKey).toMatch(/^sk_[0-9a-f]{64}$/)
    // Owner-only: the new sk_ logs in as role "owner", so an admin floor here
    // would be an admin→owner escalation.
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("owner")

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

describe("updateLimitsAction — malformed input is refused, never read as 'inherit'", () => {
  const limits = (fields: Record<string, string>) => {
    const f = new FormData()
    f.set("agent_id", "agent_1")
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    return updateLimitsAction({ ok: false, error: "" }, f)
  }

  beforeEach(() => {
    sessionMock.requireSessionRole.mockResolvedValue({ id: "wallet_1" })
    dbMock.agent.findUnique.mockResolvedValue({ id: "agent_1", walletId: "wallet_1" })
    dbMock.agent.update.mockResolvedValue({})
  })

  it.each(["-5", "abc", "1e999"])("rejects budget %s instead of removing the cap", async (bad) => {
    const res = await limits({ daily_spend_budget_usd: bad })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/budget/i)
    expect(dbMock.agent.update).not.toHaveBeenCalled()
  })

  it.each(["next tuesday", "2026-02-30"])("rejects expiry %s instead of clearing it", async (bad) => {
    const res = await limits({ expires_at: bad })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/expir/i)
    expect(dbMock.agent.update).not.toHaveBeenCalled()
  })

  it("blank still means inherit / no expiry; valid values are stored in cents", async () => {
    const res = await limits({ daily_spend_budget_usd: "", per_transaction_max_usd: "12.5", expires_at: "" })
    expect(res.ok).toBe(true)
    const data = dbMock.agent.update.mock.calls[0][0].data
    expect(data.dailySpendBudgetUsd).toBeNull()
    expect(data.perTransactionMaxUsd).toBe(1250)
    expect(data.expiresAt).toBeNull()
  })
})
