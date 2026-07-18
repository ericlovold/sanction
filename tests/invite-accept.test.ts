import { describe, it, expect, vi, beforeEach } from "vitest"
import { hashApiKey } from "../lib/apiKey"

// Invite-accept (WALLET-MEMBERS) — mirrors app/login/actions.ts's MagicLink
// single-use-claim test shape: email-match gate and the race-safe updateMany
// claim. The pre-existing-wallet collision guard is gone as of part 2: the
// wallet switcher makes every active membership reachable, and acceptance
// lands the member in the workspace they just joined.
const { dbMock, sessionMock, redirectMock, setActiveWalletMock } = vi.hoisted(() => ({
  dbMock: {
    walletMember: { findUnique: vi.fn(), updateMany: vi.fn() },
    wallet: { findFirst: vi.fn() },
  },
  sessionMock: { getSession: vi.fn() },
  setActiveWalletMock: vi.fn(async () => {}),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: sessionMock.getSession } } }))
vi.mock("@/lib/session", () => ({ setActiveWallet: setActiveWalletMock }))

import { acceptInviteAction } from "../app/invite/[token]/actions"

const TOKEN = "raw-invite-token"
const INVITE = {
  id: "member_1",
  walletId: "wallet_1",
  email: "cfo@meridian.com",
  role: "admin",
  status: "pending",
  tokenHash: hashApiKey(TOKEN),
  tokenExpiresAt: new Date(Date.now() + 60_000),
}

function form(token = TOKEN) {
  const f = new FormData()
  f.set("token", token)
  return f
}

beforeEach(() => vi.clearAllMocks())

describe("acceptInviteAction", () => {
  it("errors with no token", async () => {
    const res = await acceptInviteAction({ error: "" }, new FormData())
    expect(res.error).toMatch(/missing/i)
  })

  it("errors when not signed in", async () => {
    sessionMock.getSession.mockResolvedValue(null)
    const res = await acceptInviteAction({ error: "" }, form())
    expect(res.error).toMatch(/sign in/i)
    expect(dbMock.walletMember.findUnique).not.toHaveBeenCalled()
  })

  it("errors on an invalid or expired invite", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: "u1", email: "cfo@meridian.com" } })
    dbMock.walletMember.findUnique.mockResolvedValue(null)
    const res = await acceptInviteAction({ error: "" }, form())
    expect(res.error).toMatch(/invalid or has expired/i)
  })

  it("errors when the signed-in email doesn't match the invite", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: "u1", email: "someone-else@meridian.com" } })
    dbMock.walletMember.findUnique.mockResolvedValue(INVITE)
    const res = await acceptInviteAction({ error: "" }, form())
    expect(res.error).toContain("cfo@meridian.com")
    expect(dbMock.wallet.findFirst).not.toHaveBeenCalled()
  })

  it("accepts even when the invitee already owns a different wallet — the switcher makes it reachable (part 2 regression)", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: "u1", email: "cfo@meridian.com" } })
    dbMock.walletMember.findUnique.mockResolvedValue(INVITE)
    dbMock.wallet.findFirst.mockResolvedValue({ id: "wallet_other", userId: "u1" })
    dbMock.walletMember.updateMany.mockResolvedValue({ count: 1 })
    await expect(acceptInviteAction({ error: "" }, form())).rejects.toThrow("REDIRECT:/dashboard")
    expect(setActiveWalletMock).toHaveBeenCalledWith("wallet_1")
  })

  it("claims the invite and redirects to /dashboard on success", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: "u1", email: "cfo@meridian.com" } })
    dbMock.walletMember.findUnique.mockResolvedValue(INVITE)
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.walletMember.updateMany.mockResolvedValue({ count: 1 })

    await expect(acceptInviteAction({ error: "" }, form())).rejects.toThrow("REDIRECT:/dashboard")

    // Lands the member in the workspace they just joined.
    expect(setActiveWalletMock).toHaveBeenCalledWith("wallet_1")
    const call = dbMock.walletMember.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: INVITE.id, status: "pending" })
    expect(call.data.status).toBe("active")
    expect(call.data.userId).toBe("u1")
    expect(call.data.tokenHash).toBeNull()
  })

  it("errors if the invite was already claimed by a concurrent request (race)", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { id: "u1", email: "cfo@meridian.com" } })
    dbMock.walletMember.findUnique.mockResolvedValue(INVITE)
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.walletMember.updateMany.mockResolvedValue({ count: 0 })

    const res = await acceptInviteAction({ error: "" }, form())
    expect(res.error).toMatch(/already used/i)
  })
})
