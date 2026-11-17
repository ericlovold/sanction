import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@/lib/generated/prisma/client"

const { dbMock } = vi.hoisted(() => ({ dbMock: {
  wallet: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
} }))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { GET } from "../app/api/cron/cleanup/route"

function request(authorization?: string) {
  return new NextRequest("https://test.local/api/cron/cleanup", {
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("CRON_SECRET", "cleanup-test-secret")
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
  dbMock.wallet.findMany.mockResolvedValue([{ id: "wallet-a" }, { id: "wallet-b" }])
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(0)
  dbMock.$queryRaw.mockResolvedValue([{ id: "token-a" }, { id: "token-b" }])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("expired-record cleanup cron", () => {
  it.each([undefined, "Bearer wrong", "cleanup-test-secret", "Bearer cleanup-test-secret-extra"])(
    "refuses an invalid bearer without reading or deleting records (%s)", async (authorization) => {
      const response = await GET(request(authorization))
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(dbMock.wallet.findMany).not.toHaveBeenCalled()
      expect(dbMock.$executeRaw).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, ""])("fails closed when the secret is unavailable (%s)", async (secret) => {
    vi.stubEnv("CRON_SECRET", secret)
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(401)
    expect(dbMock.wallet.findMany).not.toHaveBeenCalled()
  })

  it("reports counts and capped batches after tenant-scoped cleanup", async () => {
    dbMock.$executeRaw
      .mockResolvedValueOnce(1) // tenant scope
      .mockResolvedValueOnce(0) // savepoint
      .mockResolvedValueOnce(2) // execution tokens
      .mockResolvedValueOnce(0) // release savepoint
      .mockResolvedValueOnce(3) // legacy magic links
      .mockResolvedValueOnce(4) // Better Auth verification values
      .mockResolvedValueOnce(1_000) // rate limits
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      deleted: { executionTokens: 2, magicLinks: 3, verifications: 4, rateLimits: 1_000 },
      batchFull: ["rateLimits"], failed: [], retainedExecutionTokens: 0,
    })
    expect(dbMock.$executeRaw.mock.calls[0][1]).toBe("wallet-a,wallet-b")
  })

  it("keeps successful table progress and returns failure when another batch fails", async () => {
    dbMock.$queryRaw.mockRejectedValueOnce(new Error("database unavailable"))
    dbMock.$executeRaw.mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3).mockResolvedValueOnce(4).mockResolvedValueOnce(5)
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      deleted: { executionTokens: 0, magicLinks: 3, verifications: 4, rateLimits: 5 },
      batchFull: [], failed: ["executionTokens"], retainedExecutionTokens: 0,
    })
  })

  it("cleans global authentication metadata when there are no wallets", async () => {
    dbMock.wallet.findMany.mockResolvedValue([])
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      deleted: { executionTokens: 0, magicLinks: 0, verifications: 0, rateLimits: 0 },
      batchFull: [], failed: [], retainedExecutionTokens: 0,
    })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    { code: "23503" },
    { driverAdapterError: { cause: { originalCode: "23503" } } },
  ])("retains hidden foreign-key references while deleting unrelated candidates (%j)", async (meta) => {
    dbMock.$queryRaw.mockResolvedValue([{ id: "protected" }, { id: "unused" }])
    dbMock.$executeRaw.mockImplementation(async (sql: TemplateStringsArray, ids: string[]) => {
      if (!sql.join("").includes('DELETE FROM "ExecutionToken"')) return 0
      if (ids.includes("protected")) throw new Prisma.PrismaClientKnownRequestError("foreign key", {
        code: "P2010", clientVersion: "test", meta,
      })
      return ids.length
    })
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      deleted: { executionTokens: 1 }, retainedExecutionTokens: 1, failed: [],
    })
  })

  it("reports other delete failures instead of treating them as retained audit references", async () => {
    dbMock.$executeRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (sql.join("").includes('DELETE FROM "ExecutionToken"')) throw new Error("query failed")
      return 0
    })
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      deleted: { executionTokens: 0 }, retainedExecutionTokens: 0, failed: ["executionTokens"],
    })
  })

  it("finishes an empty token batch without attempting token deletion", async () => {
    dbMock.$queryRaw.mockResolvedValue([])
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(200)
    expect(dbMock.$executeRaw.mock.calls.some(([sql]) => sql.join("").includes('DELETE FROM "ExecutionToken"'))).toBe(false)
  })

  it("reports an enumeration failure without exposing database details", async () => {
    dbMock.wallet.findMany.mockRejectedValue(new Error("database connection detail"))
    const response = await GET(request("Bearer cleanup-test-secret"))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Cleanup failed" })
    expect(dbMock.$executeRaw).not.toHaveBeenCalled()
  })
})
