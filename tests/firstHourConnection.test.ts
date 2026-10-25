import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const dbMock = vi.hoisted(() => ({
  wallet: { findFirst: vi.fn() },
  mcpOAuthConnection: { findFirst: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
import { hasActiveMcpConnection } from "@/lib/firstHourConnection"

const now = new Date("2026-10-25T12:00:00Z")
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("SANCTION_MCP_OAUTH_ENABLED", "true")
  vi.useFakeTimers()
  vi.setSystemTime(now)
  dbMock.wallet.findFirst.mockResolvedValue({ userId: "owner_1", members: [] })
  dbMock.mcpOAuthConnection.findFirst.mockResolvedValue({ id: "connection_1" })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("first-hour saved MCP connection signal", () => {
  it.each(["false", undefined])("returns false without DB reads when OAuth is disabled (%s)", async (enabled) => {
    vi.stubEnv("SANCTION_MCP_OAUTH_ENABLED", enabled)
    expect(await hasActiveMcpConnection("wallet_1")).toBe(false)
    expect(dbMock.wallet.findFirst).not.toHaveBeenCalled()
    expect(dbMock.mcpOAuthConnection.findFirst).not.toHaveBeenCalled()
  })

  it("requires a wallet-scoped unrevoked connection and active unexpired same-wallet agent", async () => {
    expect(await hasActiveMcpConnection("wallet_1")).toBe(true)
    expect(dbMock.wallet.findFirst).toHaveBeenCalledWith({
      where: { id: "wallet_1" },
      select: {
        userId: true,
        members: {
          where: { walletId: "wallet_1", status: "active", role: { in: ["owner", "admin"] } },
          select: { userId: true },
        },
      },
    })
    expect(dbMock.mcpOAuthConnection.findFirst).toHaveBeenCalledWith({
      where: {
        walletId: "wallet_1", userId: { in: ["owner_1"] }, revokedAt: null,
        agent: {
          walletId: "wallet_1", isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
      select: { id: true },
    })
  })

  it("accepts active owner/admin members and excludes null or duplicate identities", async () => {
    dbMock.wallet.findFirst.mockResolvedValue({
      userId: "owner_1", members: [{ userId: "admin_1" }, { userId: "owner_1" }, { userId: null }],
    })
    expect(await hasActiveMcpConnection("wallet_1")).toBe(true)
    expect(dbMock.mcpOAuthConnection.findFirst.mock.calls[0][0].where.userId).toEqual({
      in: ["owner_1", "admin_1"],
    })
  })

  it.each([null, { userId: null, members: [] }, { userId: null, members: [{ userId: null }] }])(
    "returns false when no current owner or eligible membership exists", async (wallet) => {
      dbMock.wallet.findFirst.mockResolvedValue(wallet)
      expect(await hasActiveMcpConnection("wallet_1")).toBe(false)
      expect(dbMock.mcpOAuthConnection.findFirst).not.toHaveBeenCalled()
    },
  )

  it("does not count a connection belonging to a former owner or removed member", async () => {
    dbMock.wallet.findFirst.mockResolvedValue({ userId: "new_owner", members: [] })
    dbMock.mcpOAuthConnection.findFirst.mockImplementation(async ({ where }) =>
      where.userId.in.includes("former_owner") ? { id: "old_connection" } : null)
    expect(await hasActiveMcpConnection("wallet_1")).toBe(false)
  })

  it("returns false when no connection satisfies the revocation and agent filters", async () => {
    dbMock.mcpOAuthConnection.findFirst.mockResolvedValue(null)
    expect(await hasActiveMcpConnection("wallet_1")).toBe(false)
  })

  it("rechecks state on every call", async () => {
    expect(await hasActiveMcpConnection("wallet_1")).toBe(true)
    dbMock.wallet.findFirst.mockResolvedValue({ userId: null, members: [] })
    expect(await hasActiveMcpConnection("wallet_1")).toBe(false)
    expect(dbMock.wallet.findFirst).toHaveBeenCalledTimes(2)
  })

  it("propagates database failures instead of claiming a connection", async () => {
    dbMock.mcpOAuthConnection.findFirst.mockRejectedValue(new Error("DB unavailable"))
    await expect(hasActiveMcpConnection("wallet_1")).rejects.toThrow("DB unavailable")
  })
})
