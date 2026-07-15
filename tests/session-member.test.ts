import { describe, it, expect, vi, beforeEach } from "vitest"
import { hashApiKey } from "../lib/apiKey"

// getSessionMember (WALLET-MEMBERS) — the role-aware sibling of
// getSessionWallet. Covers the four resolution branches: legacy sk_ session
// (owner), Better Auth session for the wallet's own creator (owner), an
// active WalletMember (its own role), and the fail-closed race guard.
const { dbMock, cookieStore, sessionMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    walletMember: { findFirst: vi.fn() },
    agent: { create: vi.fn() },
  },
  cookieStore: { get: vi.fn() },
  sessionMock: { getSession: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore, headers: async () => new Headers() }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: sessionMock.getSession } } }))

import { getSessionMember } from "../lib/session"

const SK = "sk_ownertestkey"
const WALLET = { id: "wallet_1", name: "Meridian", ownerEmail: "cto@meridian.com", userId: "user_owner" }
const USER = { id: "user_owner", email: "cto@meridian.com", name: "CTO" }

beforeEach(() => vi.clearAllMocks())

describe("getSessionMember", () => {
  it("returns null with no session at all", async () => {
    sessionMock.getSession.mockResolvedValue(null)
    cookieStore.get.mockReturnValue(undefined)
    expect(await getSessionMember()).toBeNull()
  })

  it("legacy sk_ cookie session resolves to owner", async () => {
    sessionMock.getSession.mockResolvedValue(null)
    cookieStore.get.mockReturnValue({ value: SK })
    dbMock.wallet.findUnique.mockResolvedValue(WALLET)

    const result = await getSessionMember()
    expect(result?.role).toBe("owner")
    expect(result?.actor).toEqual({ type: "key" })
    expect(dbMock.wallet.findUnique.mock.calls[0][0].where).toEqual({ mgmtKeyHash: hashApiKey(SK) })
  })

  it("Better Auth session for the wallet's own creator resolves to owner", async () => {
    sessionMock.getSession.mockResolvedValue({ user: USER })
    dbMock.wallet.findFirst.mockResolvedValue(WALLET) // resolveWalletForUser: owns this wallet

    const result = await getSessionMember()
    expect(result?.role).toBe("owner")
    expect(result?.actor).toEqual({ type: "user", userId: "user_owner", email: "cto@meridian.com", name: "CTO" })
    expect(dbMock.walletMember.findFirst).not.toHaveBeenCalled() // owner path never needs the membership table
  })

  it("an invited member resolves to their own WalletMember role", async () => {
    const cfo = { id: "user_cfo", email: "cfo@meridian.com", name: "CFO" }
    sessionMock.getSession.mockResolvedValue({ user: cfo })
    // resolveWalletForUser: not an owner, not claimable by email — lands on the wallet via an active membership.
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(WALLET) // 1st: ownerEmail claim miss; 2nd: membership.walletId lookup
    dbMock.walletMember.findFirst
      .mockResolvedValueOnce({ walletId: WALLET.id, userId: cfo.id, status: "active" }) // resolveWalletForUser's lookup
      .mockResolvedValueOnce({ walletId: WALLET.id, userId: cfo.id, status: "active", role: "admin" }) // getSessionMember's own re-check

    const result = await getSessionMember()
    expect(result?.wallet.id).toBe(WALLET.id)
    expect(result?.role).toBe("admin")
  })

  it("fails closed (not defaults to a role) if the membership vanishes between the two lookups", async () => {
    const viewer = { id: "user_ceo", email: "ceo@meridian.com", name: "CEO" }
    sessionMock.getSession.mockResolvedValue({ user: viewer })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(WALLET)
    dbMock.walletMember.findFirst
      .mockResolvedValueOnce({ walletId: WALLET.id, userId: viewer.id, status: "active" }) // present during resolveWalletForUser
      .mockResolvedValueOnce(null) // gone by the time getSessionMember re-checks (e.g. revoked mid-request)

    expect(await getSessionMember()).toBeNull()
  })
})
