import { describe, it, expect, vi, beforeEach } from "vitest"

// Claim-by-email (lib/session.ts resolveWalletForUser). POST /wallets and /start
// accept an unverified owner_email and hand back the sk_ key, so a wallet whose
// ownerEmail matches a signing-in user may have been squatted by whoever holds
// that key. A claim therefore requires a provider-verified email, and a
// successful claim rotates every credential minted before it: the sk_ key is
// cleared, agent keys are replaced and deactivated, live execution tokens are
// revoked, and memberships the key holder handed out are revoked.
const { dbMock, cookieStore, sessionMock } = vi.hoisted(() => {
  const dbMock = {
    wallet: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    walletMember: { findFirst: vi.fn(), updateMany: vi.fn() },
    agent: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    executionToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return { dbMock, cookieStore: { get: vi.fn() }, sessionMock: { getSession: vi.fn() } }
})
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore, headers: async () => new Headers() }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: sessionMock.getSession } } }))

import { getSessionMember, getSessionWallet } from "../lib/session"

const SQUATTED = {
  id: "wallet_sq",
  name: "victim's workspace",
  ownerEmail: "victim@corp.com",
  userId: null,
  mgmtKeyHash: "attacker_hash",
  mgmtKeyPrefix: "sk_attacker",
}
const VICTIM = { id: "user_victim", email: "victim@corp.com", name: "Victim" }

beforeEach(() => {
  vi.resetAllMocks()
  cookieStore.get.mockReturnValue(undefined)
  dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

describe("resolveWalletForUser — claim-by-email", () => {
  it("a verified claim links the wallet and rotates every pre-claim credential in one transaction", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(SQUATTED) // ownerEmail lookup
      .mockResolvedValueOnce({ ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null }) // post-claim re-read
    dbMock.wallet.updateMany.mockResolvedValue({ count: 1 })
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", apiKeyHash: "attacker_agent_hash_1" },
      { id: "agent_2", apiKeyHash: "attacker_agent_hash_2" },
    ])

    const result = await getSessionMember()

    expect(result?.wallet.id).toBe(SQUATTED.id)
    expect(result?.role).toBe("owner")
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)

    // Conditional on still being unclaimed (race-safe), and kills the sk_ key.
    const claim = dbMock.wallet.updateMany.mock.calls[0][0]
    expect(claim.where).toEqual({ id: SQUATTED.id, userId: null })
    expect(claim.data).toEqual({ userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null })

    // Every agent key replaced with an unknowable hash and deactivated.
    expect(dbMock.agent.findMany.mock.calls[0][0].where).toEqual({ walletId: SQUATTED.id })
    expect(dbMock.agent.update).toHaveBeenCalledTimes(2)
    for (const [call, old] of [
      [dbMock.agent.update.mock.calls[0][0], "attacker_agent_hash_1"],
      [dbMock.agent.update.mock.calls[1][0], "attacker_agent_hash_2"],
    ] as const) {
      expect(call.data.isActive).toBe(false)
      expect(call.data.apiKeyHash).toMatch(/^[0-9a-f]{64}$/)
      expect(call.data.apiKeyHash).not.toBe(old)
    }

    // Live execution JWTs revoked; memberships handed out by the key holder revoked.
    const tokens = dbMock.executionToken.updateMany.mock.calls[0][0]
    expect(tokens.where).toEqual({ walletId: SQUATTED.id, status: "active" })
    expect(tokens.data.status).toBe("revoked")
    expect(tokens.data.revokedAt).toBeInstanceOf(Date)
    const members = dbMock.walletMember.updateMany.mock.calls[0][0]
    expect(members.where).toEqual({ walletId: SQUATTED.id, status: { not: "revoked" } })
    expect(members.data).toEqual({ status: "revoked", tokenHash: null, tokenExpiresAt: null })

    // The old non-rotating update path is gone.
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  it("an unverified user never claims — or is handed — a squatted wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: false } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    // Even if a create were attempted it would collide on ownerEmail.
    dbMock.wallet.create.mockRejectedValue(new Error("Unique constraint failed on ownerEmail"))

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
  })

  it("a missing emailVerified flag is treated as unverified", async () => {
    sessionMock.getSession.mockResolvedValue({ user: VICTIM })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.walletMember.findFirst.mockResolvedValue(null)

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
  })

  it("an unverified user losing a create race is not handed the winner's wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: false } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(null) // no wallet at lookup time
      .mockResolvedValueOnce(SQUATTED) // a squat landed before our create
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    dbMock.wallet.create.mockRejectedValue(new Error("Unique constraint failed on ownerEmail"))

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
  })

  it("a verified user whose claim loses the race gets nothing rather than a stale wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.wallet.updateMany.mockResolvedValue({ count: 0 }) // someone else linked it first
    dbMock.walletMember.findFirst.mockResolvedValue(null)

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(dbMock.agent.update).not.toHaveBeenCalled()
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
  })

  it("an already-linked wallet is returned untouched — no re-claim, no rotation", async () => {
    const linked = { ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: "owner_hash", mgmtKeyPrefix: "sk_owner" }
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(linked)

    const result = await getSessionMember()
    expect(result?.wallet).toBe(linked)
    expect(result?.role).toBe("owner")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
    expect(dbMock.agent.update).not.toHaveBeenCalled()
  })

  it("a verified user without a wallet still gets one provisioned", async () => {
    const fresh = { id: "wallet_new", ownerEmail: VICTIM.email, userId: VICTIM.id }
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    dbMock.wallet.create.mockResolvedValue(fresh)
    dbMock.agent.create.mockResolvedValue({})

    const result = await getSessionMember()
    expect(result?.wallet.id).toBe("wallet_new")
    expect(result?.role).toBe("owner")
  })
})
