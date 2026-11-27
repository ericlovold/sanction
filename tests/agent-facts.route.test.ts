import { beforeEach, describe, expect, it, vi } from "vitest"

const dbMock = vi.hoisted(() => ({
  agent: { findMany: vi.fn() },
  wallet: { findUnique: vi.fn() },
}))
const slackCount = vi.hoisted(() => vi.fn())
const getSessionMember = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rls", () => ({
  withTenant: (_walletId: string, fn: (tx: unknown) => unknown) => fn({ slackInstall: { count: slackCount } }),
}))
vi.mock("@/lib/session", () => ({ getSessionMember }))
import { GET } from "@/app/api/connect/agent-facts/route"

const wallet = { id: "wallet_1", name: "Northwind Robotics", mgmtKeyHash: "hash", ownerEmail: "owner@example.com" }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("SANCTION_WALLET_ID", "demo_wallet")
  dbMock.agent.findMany.mockResolvedValue([{ name: "grok-bot" }, { name: "research" }])
  slackCount.mockResolvedValue(0)
})

describe("GET /api/connect/agent-facts", () => {
  it("returns nothing for a signed-out visitor and never reads the demo wallet", async () => {
    getSessionMember.mockResolvedValue(null)
    const response = await GET()
    expect(await response.json()).toEqual({ account: null })
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(dbMock.wallet.findUnique).not.toHaveBeenCalled()
    expect(dbMock.agent.findMany).not.toHaveBeenCalled()
  })

  it("returns display names and two booleans for a session: no ids, keys or emails", async () => {
    getSessionMember.mockResolvedValue({ wallet, role: "owner", actor: { type: "key" } })
    slackCount.mockResolvedValue(1)
    const body = await (await GET()).json()
    expect(body).toEqual({ account: { wallet: "Northwind Robotics", seats: ["grok-bot", "research"], admin: true, slack: true } })
    expect(JSON.stringify(body)).not.toMatch(/wallet_1|hash|owner@example\.com/)
  })

  it("lists only active, unexpired seats of that wallet and only approval-receiving Slack installs", async () => {
    getSessionMember.mockResolvedValue({ wallet, role: "viewer", actor: { type: "user", userId: "u1", email: "v@example.com", name: null } })
    const body = await (await GET()).json()
    expect(body.account).toMatchObject({ admin: false, slack: false })
    expect(dbMock.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId: "wallet_1", isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      select: { name: true },
    }))
    expect(slackCount).toHaveBeenCalledWith({
      where: { walletId: "wallet_1", revokedAt: null, events: { hasSome: ["approval.created", "escalation.created"] } },
    })
  })

  it("falls back to generic when the session or a lookup fails", async () => {
    getSessionMember.mockRejectedValue(new Error("Sign-in is temporarily unavailable. Please try again."))
    expect(await (await GET()).json()).toEqual({ account: null })
    getSessionMember.mockResolvedValue({ wallet, role: "admin", actor: { type: "key" } })
    dbMock.agent.findMany.mockRejectedValue(new Error("db down"))
    expect(await (await GET()).json()).toEqual({ account: null })
  })
})
