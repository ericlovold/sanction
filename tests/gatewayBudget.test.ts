import { beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock, warn } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn() },
    wallet: { findFirst: vi.fn() },
    tokenLog: { aggregate: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    gatewayReservation: { create: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  warn: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/log", () => ({ logger: () => ({ warn }) }))
vi.mock("@/lib/cascadeBudget", () => ({ walletAncestorChain: vi.fn() }))
vi.mock("@/lib/poolAccess", () => ({ walletSubtreeIds: vi.fn() }))

import { recordTokenUsageUnderBudget, releaseGatewayBudget, reserveGatewayBudget, resolveGatewayBudget } from "../lib/gatewayBudget"
import { walletAncestorChain } from "../lib/cascadeBudget"
import { walletSubtreeIds } from "../lib/poolAccess"

const AGENT = {
  id: "agent-1", walletId: "wallet-1", isActive: true, dailyTokenBudgetUsd: null,
  wallet: { policy: { dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: null } },
}
const CHAIN = [{ id: AGENT.walletId, parentId: null, policy: null }]
const INPUT = { provider: "anthropic", model: "claude-sonnet-4", reservedUsd: 1 }
const USAGE = { model: "claude-sonnet-4", tokensIn: 1000, tokensOut: 1000 }
let reservation: {
  id: string; agentId: string; walletId: string; provider: string; model: string;
  reservedUsd: number; observedUsd: number; status: string; inputRateUsdPerMillion: number; outputRateUsdPerMillion: number;
}

beforeEach(() => {
  vi.resetAllMocks()
  reservation = {
    id: "reservation-1", agentId: AGENT.id, walletId: AGENT.walletId, ...INPUT,
    observedUsd: 0, status: "pending", inputRateUsdPerMillion: 3, outputRateUsdPerMillion: 15,
  }
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(1)
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.wallet.findFirst.mockResolvedValue(null)
  dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: null } })
  dbMock.tokenLog.create.mockResolvedValue({ id: "log-1" })
  dbMock.tokenLog.upsert.mockResolvedValue({ id: "log-1" })
  dbMock.gatewayReservation.findMany.mockResolvedValue([])
  dbMock.gatewayReservation.create.mockResolvedValue(reservation)
  dbMock.gatewayReservation.findUniqueOrThrow.mockImplementation(async () => ({ ...reservation }))
  dbMock.gatewayReservation.update.mockImplementation(async ({ data }: { data: Partial<typeof reservation> }) => Object.assign(reservation, data))
  vi.mocked(walletAncestorChain).mockResolvedValue(CHAIN)
  vi.mocked(walletSubtreeIds).mockResolvedValue([AGENT.walletId])
})

describe("durable gateway admission", () => {
  it("commits a hold using the model's snapshotted rates before returning its ID", async () => {
    expect(await reserveGatewayBudget(AGENT, INPUT)).toEqual({ exhausted: false, spent: 0, budget: 10, reservationId: "reservation-1" })
    expect(dbMock.gatewayReservation.create).toHaveBeenCalledWith({ data: {
      agentId: AGENT.id, walletId: AGENT.walletId, ...INPUT, inputRateUsdPerMillion: 3, outputRateUsdPerMillion: 15, createdAt: expect.any(Date),
    } })
    expect(dbMock.agent.findUnique).toHaveBeenCalledWith({
      where: { id: AGENT.id, walletId: AGENT.walletId }, include: { wallet: { include: { policy: true } } },
    })
    expect(dbMock.agent.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(dbMock.$executeRaw.mock.invocationCallOrder.at(-1)!)
  })

  it("does not create a hold when other committed holds occupy the budget", async () => {
    dbMock.gatewayReservation.findMany.mockResolvedValue([{ reservedUsd: 10, observedUsd: 0 }])
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, spent: 10, horizon: "daily" })
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("admits the final ten cents of a thirty-cent cap despite binary floating-point dust", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { policy: { dailyTokenBudgetUsd: 30 } } })
    dbMock.gatewayReservation.findMany.mockResolvedValue([{ reservedUsd: 0.1, observedUsd: 0 }, { reservedUsd: 0.1, observedUsd: 0 }])
    expect(await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 0.1 })).toMatchObject({ exhausted: false, spent: 0.2, budget: 0.3 })
  })

  it("rounds a real fractional microdollar cost upward before holding capacity", async () => {
    await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 0.0000001 })
    expect(dbMock.gatewayReservation.create.mock.calls[0][0].data.reservedUsd).toBe(0.000001)
  })

  it("never treats a positive sub-microdollar cost as free under a zero cap", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { policy: { dailyTokenBudgetUsd: 0 } } })
    expect(await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 1e-30 })).toMatchObject({ exhausted: true, budget: 0 })
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("rejects costs beyond safe accounting precision", async () => {
    await expect(reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: Number.MAX_SAFE_INTEGER })).rejects.toThrow("safe accounting precision")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a sum that exceeds safe accounting precision", async () => {
    dbMock.gatewayReservation.findMany.mockResolvedValue([{ reservedUsd: 5_000_000_000, observedUsd: 0 }, { reservedUsd: 5_000_000_000, observedUsd: 0 }])
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("safe accounting precision")
  })

  it("never rounds malformed fractional-cent caps upward", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { policy: { dailyTokenBudgetUsd: 0.5 } } })
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Invalid token budget")
  })

  it("uses a lower policy loaded after locking instead of the caller's earlier policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { policy: { dailyTokenBudgetUsd: 50 } } })
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, budget: 0.5 })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("refuses invalid reservation cost %s without DB work", async (reservedUsd) => {
    await expect(reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd })).rejects.toThrow("Invalid token cost")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([null, { ...AGENT, isActive: false }, { ...AGENT, expiresAt: new Date(0) }])("refuses a missing, revoked, or expired seat under the lock", async (agent) => {
    dbMock.agent.findUnique.mockResolvedValue(agent)
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("no longer authorized")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("accepts a still-valid seat expiry", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, expiresAt: new Date(Date.now() + 60_000) })
    expect((await reserveGatewayBudget(AGENT, INPUT)).exhausted).toBe(false)
  })

  it("rejects newly frozen ancestors before reserving or reporting more spend", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValue([{ ...CHAIN[0], frozenAt: new Date() }])
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Wallet is frozen")
    await expect(recordTokenUsageUnderBudget(AGENT, { ...USAGE, costUsd: 0.1 })).rejects.toThrow("Wallet is frozen")
  })

  it.each([{ chain: [] }, { chain: [{ id: "wrong-wallet", parentId: null, policy: null }] }])("rejects missing or mismatched ancestry", async ({ chain }) => {
    vi.mocked(walletAncestorChain).mockResolvedValue(chain)
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Incomplete wallet ancestry")
  })

  it("rejects ancestry changes while acquiring its locks", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValueOnce(CHAIN).mockResolvedValueOnce([
      { ...CHAIN[0], parentId: "new-root" }, { id: "new-root", parentId: null, policy: null },
    ])
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("ancestry changed")
  })

  it("rejects a subtree truncated by the node limit", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValue([{ ...CHAIN[0], policy: { perTransactionMaxUsd: 0, subtreeDailyCapUsd: null, subtreeDailyTokenCapUsd: 1000 } }])
    vi.mocked(walletSubtreeIds).mockResolvedValue(Array.from({ length: 500 }, (_, i) => `wallet-${i}`))
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("traversal limit")
  })

  it("does not admit against a subtree missing the caller's own wallet", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValue([{ ...CHAIN[0], policy: { perTransactionMaxUsd: 0, subtreeDailyCapUsd: null, subtreeDailyTokenCapUsd: 1000 } }])
    vi.mocked(walletSubtreeIds).mockResolvedValue([])
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Incomplete token pool")
  })

  it("propagates a failed reservation commit without returning authority to call upstream", async () => {
    dbMock.gatewayReservation.create.mockRejectedValue(new Error("database unavailable"))
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("database unavailable")
  })

  it("rejects non-finite persisted occupancy rather than admitting through a failed comparison", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: Number.NaN } })
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Invalid token cost")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("uses the post-lock day for admission and explicit log timestamps when a wait crosses midnight", async () => {
    vi.useFakeTimers()
    try {
      const afterMidnight = new Date(2026, 10, 19, 0, 0, 1)
      vi.setSystemTime(new Date(2026, 10, 18, 23, 59, 59))
      dbMock.$executeRaw.mockImplementation(async () => {
        vi.setSystemTime(afterMidnight)
        return 1
      })
      await reserveGatewayBudget(AGENT, INPUT)
      await recordTokenUsageUnderBudget(AGENT, { ...USAGE, costUsd: 0.018 })
      await resolveGatewayBudget(reservation.id, USAGE, true)
      expect(dbMock.gatewayReservation.create.mock.calls[0][0].data.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.create.mock.calls[0][0].data.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.upsert.mock.calls[0][0].create.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.upsert.mock.calls[0][0].update.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.aggregate.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(2026, 10, 19))
      expect(dbMock.$transaction.mock.calls.every((call) => call[1].isolationLevel === "ReadCommitted")).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("gateway settlement", () => {
  it("settles one linked log and makes retries return the persisted result without writing again", async () => {
    expect(await resolveGatewayBudget(reservation.id, USAGE, true)).toBe(0.018)
    expect(reservation.status).toBe("settled")
    expect(dbMock.tokenLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { gatewayReservationId: reservation.id },
      create: expect.objectContaining({ agentId: AGENT.id, gatewayReservationId: reservation.id, costUsd: 0.018 }),
    }))
    expect(await resolveGatewayBudget(reservation.id, { ...USAGE, tokensOut: 1_000_000 }, true)).toBe(0.018)
    expect(dbMock.tokenLog.upsert).toHaveBeenCalledTimes(1)
  })

  it("retains uncertain holds with one linked observation, then finalizes that log", async () => {
    await resolveGatewayBudget(reservation.id, { ...USAGE, tokensOut: 0 }, false)
    expect(reservation).toMatchObject({ status: "uncertain", reservedUsd: 1, observedUsd: 0.003 })
    await resolveGatewayBudget(reservation.id, USAGE, true)
    expect(reservation).toMatchObject({ status: "settled", observedUsd: 0.018 })
    expect(dbMock.tokenLog.upsert.mock.calls.map(([args]) => args.where)).toEqual([
      { gatewayReservationId: reservation.id }, { gatewayReservationId: reservation.id },
    ])
    expect(dbMock.tokenLog.upsert.mock.calls[1][0].update.createdAt).toBeInstanceOf(Date)
  })

  it("never releases a no-usage or partial observation merely because its stream stopped", async () => {
    await resolveGatewayBudget(reservation.id, { model: "", tokensIn: 0, tokensOut: 0 }, false)
    await releaseGatewayBudget(reservation.id)
    expect(reservation).toMatchObject({ status: "uncertain", observedUsd: 0, reservedUsd: 1 })
  })

  it("keeps the larger observation if a later partial result regresses", async () => {
    await resolveGatewayBudget(reservation.id, USAGE, false)
    await resolveGatewayBudget(reservation.id, { ...USAGE, tokensOut: 0 }, false)
    expect(reservation.observedUsd).toBe(0.018)
    expect(dbMock.tokenLog.upsert.mock.calls[1][0].update).toEqual({})
  })

  it("keeps the hold when purported final usage contradicts the earlier partial observation", async () => {
    await resolveGatewayBudget(reservation.id, USAGE, false)
    await expect(resolveGatewayBudget(reservation.id, { ...USAGE, tokensOut: 0 }, true)).rejects.toThrow("contradicts")
    expect(reservation).toMatchObject({ status: "uncertain", reservedUsd: 1, observedUsd: 0.018 })
    expect(dbMock.tokenLog.upsert).toHaveBeenCalledTimes(1)
  })

  it("records actual overruns in full and reports the gap", async () => {
    const cost = await resolveGatewayBudget(reservation.id, { ...USAGE, tokensOut: 1_000_000 }, true)
    expect(cost).toBe(15.003)
    expect(reservation.observedUsd).toBe(15.003)
    expect(warn).toHaveBeenCalledWith("Gateway usage exceeded reserved estimate", expect.objectContaining({ reservedUsd: 1, observedUsd: 15.003 }))
  })

  it("uses snapshotted rates and the reserved model despite a different provider alias", async () => {
    reservation.inputRateUsdPerMillion = 7
    reservation.outputRateUsdPerMillion = 17
    expect(await resolveGatewayBudget(reservation.id, { ...USAGE, model: "different-alias" }, true)).toBe(0.024)
    expect(dbMock.tokenLog.upsert.mock.calls[0][0].create.model).toBe(INPUT.model)
  })

  it("prices cache writes and reads from the frozen input rate", async () => {
    const usage = { ...USAGE, tokensIn: 1000, tokensOut: 0, cacheWriteTokens: 400, cacheWrite1hTokens: 100, cacheReadTokens: 200 }
    expect(await resolveGatewayBudget(reservation.id, usage, true)).toBe(0.002985)
  })

  it.each([
    { tokensIn: -1 }, { tokensIn: Number.NaN }, { tokensOut: 1.5 }, { tokensOut: 2_147_483_648 },
    { cacheWriteTokens: 1001 }, { cacheReadTokens: 1001 }, { cacheWrite1hTokens: 1 },
  ])("leaves invalid or inconsistent usage unresolved: %j", async (invalid) => {
    await expect(resolveGatewayBudget(reservation.id, { ...USAGE, ...invalid }, true)).rejects.toThrow()
    expect(dbMock.tokenLog.upsert).not.toHaveBeenCalled()
    expect(reservation.status).toBe("pending")
  })

  it("does not remove the hold when writing the observation fails", async () => {
    dbMock.tokenLog.upsert.mockRejectedValue(new Error("write failed"))
    await expect(resolveGatewayBudget(reservation.id, USAGE, true)).rejects.toThrow("write failed")
    expect(dbMock.gatewayReservation.update).not.toHaveBeenCalled()
    expect(reservation.status).toBe("pending")
  })
})

describe("definitely unbilled gateway requests", () => {
  it("releases pending capacity once; repeated release cannot create a usage log", async () => {
    await releaseGatewayBudget(reservation.id)
    await releaseGatewayBudget(reservation.id)
    expect(reservation.status).toBe("released")
    expect(dbMock.gatewayReservation.update).toHaveBeenCalledTimes(1)
    expect(dbMock.tokenLog.upsert).not.toHaveBeenCalled()
    await expect(resolveGatewayBudget(reservation.id, USAGE, true)).rejects.toThrow("released")
  })

  it.each(["settled", "uncertain"])("never refunds a %s call", async (status) => {
    reservation.status = status
    reservation.observedUsd = 0.018
    await releaseGatewayBudget(reservation.id)
    expect(dbMock.gatewayReservation.update).not.toHaveBeenCalled()
    expect(reservation.status).toBe(status)
  })

  it("refuses to release a pending record containing an observation", async () => {
    reservation.observedUsd = 0.018
    await releaseGatewayBudget(reservation.id)
    expect(dbMock.gatewayReservation.update).not.toHaveBeenCalled()
  })
})
