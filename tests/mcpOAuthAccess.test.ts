import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JWTPayload } from "jose"

const dbMock = vi.hoisted(() => ({
  mcpOAuthConnection: { findFirst: vi.fn() }, wallet: { findFirst: vi.fn() },
  walletMember: { findFirst: vi.fn() }, agent: { findFirst: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
import { mcpConnectionIdentity } from "@/lib/mcpOAuthAccess"

const connection = { id: "connection_1", userId: "user_1", clientId: "client_1",
  walletId: "wallet_1", agentId: "agent_1", revokedAt: null }
const claims = { sanction_connection_id: connection.id, sub: connection.userId, client_id: connection.clientId }

beforeEach(() => {
  vi.resetAllMocks()
  dbMock.mcpOAuthConnection.findFirst.mockImplementation(async ({ where }) =>
    where.id === connection.id && where.userId === connection.userId &&
    where.clientId === connection.clientId && where.revokedAt === null ? connection : null)
  dbMock.wallet.findFirst.mockResolvedValue({ id: connection.walletId })
  dbMock.walletMember.findFirst.mockResolvedValue(null)
  dbMock.agent.findFirst.mockResolvedValue({ id: connection.agentId, expiresAt: null })
})

describe("MCP OAuth connection identity", () => {
  it("derives immutable identity from the connection, ignoring token wallet and agent claims", async () => {
    expect(await mcpConnectionIdentity({ ...claims, walletId: "other", agentId: "other",
      wallet_id: "other", agent_id: "other" })).toEqual({ agentId: "agent_1", walletId: "wallet_1" })
    expect(dbMock.mcpOAuthConnection.findFirst).toHaveBeenCalledWith({ where: {
      id: connection.id, userId: connection.userId, clientId: connection.clientId, revokedAt: null,
    } })
    expect(dbMock.wallet.findFirst).toHaveBeenCalledWith({
      where: { id: connection.walletId, userId: connection.userId }, select: { id: true },
    })
    expect(dbMock.agent.findFirst).toHaveBeenCalledWith({
      where: { id: connection.agentId, walletId: connection.walletId, isActive: true },
      select: { id: true, expiresAt: true },
    })
    expect(dbMock.walletMember.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    {}, { sub: "user_1", client_id: "client_1" },
    { ...claims, sanction_connection_id: 1 }, { ...claims, sub: null }, { ...claims, client_id: [] },
  ])("rejects missing or malformed binding claims before querying", async (input) => {
    expect(await mcpConnectionIdentity(input as JWTPayload)).toBeNull()
    expect(dbMock.mcpOAuthConnection.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    { ...claims, sanction_connection_id: "other" }, { ...claims, sub: "other" }, { ...claims, client_id: "other" },
  ])("rejects a connection, subject or client mismatch", async (input) => {
    expect(await mcpConnectionIdentity(input)).toBeNull()
    expect(dbMock.wallet.findFirst).not.toHaveBeenCalled()
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a revoked or deleted connection before tenant lookup", async () => {
    dbMock.mcpOAuthConnection.findFirst.mockResolvedValue(null)
    expect(await mcpConnectionIdentity(claims)).toBeNull()
    expect(dbMock.wallet.findFirst).not.toHaveBeenCalled()
  })

  it("requires current active owner/admin membership when direct ownership is absent", async () => {
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.walletMember.findFirst.mockResolvedValue({ id: "member_1" })
    expect(await mcpConnectionIdentity(claims)).toEqual({ agentId: "agent_1", walletId: "wallet_1" })
    expect(dbMock.walletMember.findFirst).toHaveBeenCalledWith({ where: {
      walletId: connection.walletId, userId: connection.userId, status: "active", role: { in: ["owner", "admin"] },
    }, select: { id: true } })
  })

  it("rejects removed, inactive or downgraded membership", async () => {
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    expect(await mcpConnectionIdentity(claims)).toBeNull()
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
  })

  it.each([null, { id: "agent_1", expiresAt: new Date(0) }])(
    "rejects inactive, deleted, moved or expired agents", async (agent) => {
      dbMock.agent.findFirst.mockResolvedValue(agent)
      expect(await mcpConnectionIdentity(claims)).toBeNull()
    },
  )

  it("accepts an unexpired agent and rechecks authority on every call", async () => {
    dbMock.agent.findFirst.mockResolvedValue({ id: "agent_1", expiresAt: new Date(Date.now() + 60_000) })
    expect(await mcpConnectionIdentity(claims)).not.toBeNull()
    dbMock.mcpOAuthConnection.findFirst.mockResolvedValue(null)
    expect(await mcpConnectionIdentity(claims)).toBeNull()
    expect(dbMock.mcpOAuthConnection.findFirst).toHaveBeenCalledTimes(2)
  })

  it("does not substitute an identity when the database fails", async () => {
    dbMock.mcpOAuthConnection.findFirst.mockRejectedValue(new Error("DB unavailable"))
    await expect(mcpConnectionIdentity(claims)).rejects.toThrow("DB unavailable")
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
  })
})
