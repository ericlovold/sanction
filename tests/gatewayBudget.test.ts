import { beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock, warn } = vi.hoisted(() => ({
  dbMock: {
    tokenLog: { create: vi.fn(), upsert: vi.fn() },
    gatewayReservation: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    authorizationRequest: { create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
  warn: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/log", () => ({ logger: () => ({ warn }) }))

import { GatewayWalletFrozenError, recordGatewayBudgetDenial, recordTokenUsageUnderBudget, releaseGatewayBudget, reserveGatewayBudget, resolveGatewayBudget } from "../lib/gatewayBudget"
import { decisionCode } from "../lib/decisions"
import type { Prisma } from "../lib/generated/prisma/client"

const AGENT = {
  id: "agent-1", walletId: "wallet-1", isActive: true, dailyTokenBudgetUsd: null,
  wallet: { policy: { dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: null } },
}
type AncestorFixture = {
  id: string; parentId: string | null; frozenAt?: Date | null; frozenReason?: string | null
  policyId: string | null; perTransactionMaxUsd: number | null
  subtreeDailyCapUsd: number | null; subtreeDailyTokenCapUsd: number | null
}
type AgentFixture = {
  id: string; walletId: string; isActive: boolean; expiresAt: Date | null
  dailyTokenBudgetUsd: number | null; monthlyTokenBudgetUsd: number | null
  policyDaily: number | null; policyMonthly: number | null
}
type OccupancyFixture = {
  scopeId: string; kind: "agent" | "pool"; walletIds: string[]; incomplete: boolean
  dailyLogs: number; monthlyLogs: number; holds: number[]
}
const CHAIN: AncestorFixture[] = [{
  id: AGENT.walletId, parentId: null, policyId: "policy-1", perTransactionMaxUsd: 0,
  subtreeDailyCapUsd: null, subtreeDailyTokenCapUsd: null,
}]
const CURRENT_AGENT: AgentFixture = {
  id: AGENT.id, walletId: AGENT.walletId, isActive: true, expiresAt: null,
  dailyTokenBudgetUsd: null, monthlyTokenBudgetUsd: null, policyDaily: 1000, policyMonthly: null,
}
const EMPTY_USAGE: OccupancyFixture = {
  scopeId: AGENT.id, kind: "agent", walletIds: [], incomplete: false, dailyLogs: 0, monthlyLogs: 0, holds: [],
}
let ancestors: AncestorFixture[]
let currentAgent: AgentFixture | null
let occupancy: OccupancyFixture[]
let afterLocks: () => void
let statements: Array<{ kind: "ancestry" | "locks" | "occupancy"; sql: string; values: unknown[] }>

function rawStatement(query: Prisma.Sql | TemplateStringsArray, values: unknown[]) {
  return "sql" in query ? { sql: query.sql, values: query.values } : { sql: query.join("?"), values }
}
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
  ancestors = CHAIN.map((node) => ({ ...node }))
  currentAgent = { ...CURRENT_AGENT }
  occupancy = [{ ...EMPTY_USAGE, holds: [] }]
  afterLocks = () => {}
  statements = []
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockImplementation(async (query: Prisma.Sql) => {
    const statement = rawStatement(query, [])
    if (!statement.sql.includes("pg_advisory_xact_lock")) throw new Error(`Unexpected SQL mutation: ${statement.sql}`)
    statements.push({ kind: "locks", ...statement })
    afterLocks()
    return 1
  })
  // These fixtures are the database's domain snapshots. PostgreSQL tests prove
  // traversal and aggregation; these tests exercise decisions over their rows.
  dbMock.$queryRaw.mockImplementation(async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const statement = rawStatement(query, values)
    if (statement.sql.includes("WITH RECURSIVE ancestors AS")) {
      statements.push({ kind: "ancestry", ...statement })
      return ancestors.map((node) => ({
        ...node,
        seatId: currentAgent?.id ?? null, seatWalletId: currentAgent?.walletId ?? null,
        seatActive: currentAgent?.isActive ?? null, seatExpiresAt: currentAgent?.expiresAt ?? null,
        seatDaily: currentAgent?.dailyTokenBudgetUsd ?? null, seatMonthly: currentAgent?.monthlyTokenBudgetUsd ?? null,
        policyDaily: node.id === AGENT.walletId ? currentAgent?.policyDaily ?? null : null,
        policyMonthly: node.id === AGENT.walletId ? currentAgent?.policyMonthly ?? null : null,
      }))
    }
    if (statement.sql.includes("WITH scopes AS")) {
      statements.push({ kind: "occupancy", ...statement })
      return occupancy
    }
    throw new Error(`Unexpected SQL read: ${statement.sql}`)
  })
  dbMock.tokenLog.create.mockResolvedValue({ id: "log-1" })
  dbMock.tokenLog.upsert.mockResolvedValue({ id: "log-1" })
  dbMock.gatewayReservation.create.mockResolvedValue(reservation)
  dbMock.gatewayReservation.findUniqueOrThrow.mockImplementation(async () => ({ ...reservation }))
  dbMock.gatewayReservation.update.mockImplementation(async ({ data }: { data: Partial<typeof reservation> }) => Object.assign(reservation, data))
  dbMock.authorizationRequest.create.mockResolvedValue({ id: "denial-1" })
})

describe("durable gateway admission", () => {
  it("commits a hold using the model's snapshotted rates before returning its ID", async () => {
    expect(await reserveGatewayBudget(AGENT, INPUT)).toEqual({ exhausted: false, spent: 0, budget: 10, reservationId: "reservation-1" })
    expect(dbMock.gatewayReservation.create).toHaveBeenCalledWith({ data: {
      agentId: AGENT.id, walletId: AGENT.walletId, ...INPUT, inputRateUsdPerMillion: 3, outputRateUsdPerMillion: 15, createdAt: expect.any(Date),
    } })
    expect(statements.map(({ kind }) => kind)).toEqual(["ancestry", "locks", "ancestry", "occupancy"])
    expect(statements[2].values).toEqual([AGENT.walletId, AGENT.id, AGENT.walletId])
    expect(dbMock.gatewayReservation.create.mock.invocationCallOrder[0]).toBeGreaterThan(dbMock.$queryRaw.mock.invocationCallOrder.at(-1)!)
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("locks sorted wallet keys before the agent, then reads every budget scope in a separate statement", async () => {
    ancestors = [
      { ...CHAIN[0], parentId: "z-parent", policyId: "leaf-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 },
      { ...CHAIN[0], id: "z-parent", parentId: "a-root", policyId: "parent-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 2000 },
      { ...CHAIN[0], id: "a-root", policyId: "root-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 3000 },
    ]
    occupancy.push(...ancestors.map((node, index) => ({
      ...EMPTY_USAGE, kind: "pool" as const, scopeId: node.id, walletIds: ancestors.slice(0, index + 1).map(({ id }) => id),
    })))
    await reserveGatewayBudget(AGENT, INPUT)
    expect(statements.map(({ kind }) => kind)).toEqual(["ancestry", "locks", "ancestry", "occupancy"])
    expect(statements[1].values).toEqual([
      "token-budget:wallet:a-root", `token-budget:wallet:${AGENT.walletId}`, "token-budget:wallet:z-parent", AGENT.id,
    ])
    expect(statements[1].sql).toMatch(/WITH ORDINALITY[\s\S]*ORDER BY k\.ord/)
    expect(statements[1].sql).not.toMatch(/\b(?:LIMIT|DISTINCT|GROUP BY)\b/)
    expect(statements.at(-1)?.values.filter((value) => typeof value === "string")).toEqual([AGENT.id, AGENT.walletId, "z-parent", "a-root"])
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(3)
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it.each(["reserve", "report", "settle", "release"] as const)("retains default deadlines without SQL settings overrides for %s", async (operation) => {
    if (operation === "reserve") await reserveGatewayBudget(AGENT, INPUT)
    if (operation === "report") await recordTokenUsageUnderBudget(AGENT, { ...USAGE, costUsd: 0.018 })
    if (operation === "settle") await resolveGatewayBudget(reservation.id, USAGE, true)
    if (operation === "release") await releaseGatewayBudget(reservation.id)
    expect(dbMock.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: "ReadCommitted" })
    expect(statements.map(({ sql }) => sql).join("\n")).not.toMatch(/\b(?:SET|set_config|statement_timeout|lock_timeout|idle_in_transaction_session_timeout)\b/i)
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it("reads a sibling's newly committed hold after the lock wait", async () => {
    ancestors = [
      { ...CHAIN[0], parentId: "parent" },
      { ...CHAIN[0], id: "parent", policyId: "parent-policy", subtreeDailyTokenCapUsd: 1000 },
    ]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: "parent", walletIds: ["parent", AGENT.walletId, "sibling"] })
    afterLocks = () => { occupancy[1].holds = [10] }
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, spent: 10, horizon: "subtree-daily", capWalletId: "parent" })
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
    expect(statements.findIndex(({ kind }) => kind === "occupancy")).toBeGreaterThan(statements.findIndex(({ kind }) => kind === "locks"))
  })

  it("does not create a hold when other committed holds occupy the budget", async () => {
    occupancy[0].holds = [10]
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, spent: 10, horizon: "daily", decisionId: "denial-1" })
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      agentId: AGENT.id, status: "denied", amountUsd: 0,
      detailsJson: expect.objectContaining({ wallet_id: AGENT.walletId, provider: INPUT.provider, model: INPUT.model, horizon: "daily", occupied_usd: 10, limit_usd: 10, requested_reservation_usd: 1 }),
    }) }))
  })

  it("admits the final ten cents of a thirty-cent cap despite binary floating-point dust", async () => {
    currentAgent!.policyDaily = 30
    occupancy[0].holds = [0.1, 0.1]
    expect(await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 0.1 })).toMatchObject({ exhausted: false, spent: 0.2, budget: 0.3 })
  })

  it("rounds individual holds upward while ignoring dust in the accumulated logs", async () => {
    occupancy[0].dailyLogs = 0.1 + 0.2
    occupancy[0].holds = [0.0000001, 0.0000001]
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: false, spent: 0.300002 })
  })

  it("applies the monthly cap to monthly logs plus the same unresolved holds", async () => {
    currentAgent!.policyMonthly = 2000
    occupancy[0] = { ...EMPTY_USAGE, dailyLogs: 1, monthlyLogs: 19, holds: [0.5] }
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, horizon: "monthly", spent: 19.5, budget: 20 })
  })

  it.each([
    { seat: null, policy: null, monthly: false },
    { seat: null, policy: 1000, monthly: true },
    { seat: 1000, policy: null, monthly: true },
    { seat: 0, policy: null, monthly: true },
  ])("requests a monthly snapshot only when a monthly cap exists: %j", async ({ seat, policy, monthly }) => {
    currentAgent!.monthlyTokenBudgetUsd = seat
    currentAgent!.policyMonthly = policy
    await reserveGatewayBudget(AGENT, INPUT)
    expect(statements.at(-1)?.values.filter((value) => typeof value === "boolean")).toEqual([monthly])
  })

  it("checks an ancestor pool even when the seat and its wallet have no local policy", async () => {
    currentAgent!.policyDaily = null
    ancestors = [
      { ...CHAIN[0], parentId: "parent", policyId: null, perTransactionMaxUsd: null },
      { ...CHAIN[0], id: "parent", policyId: "parent-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 },
    ]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: "parent", walletIds: ["parent", AGENT.walletId, "sibling"], dailyLogs: 8, holds: [1.5] })
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, horizon: "subtree-daily", capWalletId: "parent", spent: 9.5, budget: 10 })
  })

  it("preserves daily, monthly, then leaf-to-root denial precedence regardless of snapshot row order", async () => {
    currentAgent!.policyMonthly = 1000
    ancestors = [
      { ...CHAIN[0], parentId: "parent", policyId: "leaf-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 },
      { ...CHAIN[0], id: "parent", policyId: "parent-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 },
    ]
    const own = { ...EMPTY_USAGE, dailyLogs: 10, monthlyLogs: 10 }
    occupancy = [
      { ...EMPTY_USAGE, kind: "pool", scopeId: "parent", walletIds: ["parent", AGENT.walletId], dailyLogs: 10 },
      { ...EMPTY_USAGE, kind: "pool", scopeId: AGENT.walletId, walletIds: [AGENT.walletId], dailyLogs: 10 },
      own,
    ]
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ horizon: "daily" })
    own.dailyLogs = 0
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ horizon: "monthly" })
    own.monthlyLogs = 0
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ horizon: "subtree-daily", capWalletId: AGENT.walletId })
  })

  it("rounds a real fractional microdollar cost upward before holding capacity", async () => {
    await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 0.0000001 })
    expect(dbMock.gatewayReservation.create.mock.calls[0][0].data.reservedUsd).toBe(0.000001)
  })

  it("never treats a positive sub-microdollar cost as free under a zero cap", async () => {
    currentAgent!.policyDaily = 0
    expect(await reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: 1e-30 })).toMatchObject({ exhausted: true, budget: 0 })
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("rejects costs beyond safe accounting precision", async () => {
    await expect(reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd: Number.MAX_SAFE_INTEGER })).rejects.toThrow("safe accounting precision")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a sum that exceeds safe accounting precision", async () => {
    occupancy[0].holds = [5_000_000_000, 5_000_000_000]
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("safe accounting precision")
  })

  it("never rounds malformed fractional-cent caps upward", async () => {
    currentAgent!.policyDaily = 0.5
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Invalid token budget")
  })

  it("uses a lower policy loaded after locking instead of the caller's earlier policy", async () => {
    afterLocks = () => { currentAgent!.policyDaily = 50 }
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, budget: 0.5 })
  })

  it("uses an ancestor cap newly enabled during the lock wait", async () => {
    afterLocks = () => {
      ancestors[0] = { ...CHAIN[0], policyId: "new-policy", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 50 }
    }
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: AGENT.walletId, walletIds: [AGENT.walletId] })
    expect(await reserveGatewayBudget(AGENT, INPUT)).toMatchObject({ exhausted: true, horizon: "subtree-daily", budget: 0.5 })
    expect(statements[1].values).toContain(`token-budget:wallet:${AGENT.walletId}`)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("refuses invalid reservation cost %s without DB work", async (reservedUsd) => {
    await expect(reserveGatewayBudget(AGENT, { ...INPUT, reservedUsd })).rejects.toThrow("Invalid token cost")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([null, { ...CURRENT_AGENT, isActive: false }, { ...CURRENT_AGENT, expiresAt: new Date(0) }])("refuses a missing, revoked, or expired seat under the lock", async (agent) => {
    afterLocks = () => { currentAgent = agent }
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("no longer authorized")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("accepts a still-valid seat expiry", async () => {
    currentAgent!.expiresAt = new Date(Date.now() + 60_000)
    expect((await reserveGatewayBudget(AGENT, INPUT)).exhausted).toBe(false)
  })

  it("rejects newly frozen ancestors before reserving or reporting more spend", async () => {
    afterLocks = () => { ancestors[0].frozenAt = new Date() }
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Wallet is frozen")
    await expect(recordTokenUsageUnderBudget(AGENT, { ...USAGE, costUsd: 0.1 })).rejects.toThrow("Wallet is frozen")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("exposes the verified parent freeze as a typed policy denial", async () => {
    ancestors = [
      { ...CHAIN[0], parentId: "parent" },
      { ...CHAIN[0], id: "parent", frozenAt: new Date(), frozenReason: "Paused" },
    ]
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toMatchObject({
      name: "GatewayWalletFrozenError", code: "WALLET_FROZEN", message: "Parent wallet is frozen",
      freeze: { frozen: true, frozenWalletId: "parent", self: false, reason: "Paused" },
    })
  })

  it("does not label an unverifiable hierarchy as a verified freeze", async () => {
    ancestors = [
      { ...CHAIN[0], parentId: "missing-parent" },
      { ...CHAIN[0], id: "different-parent" },
    ]
    const result = reserveGatewayBudget(AGENT, INPUT)
    await expect(result).rejects.toThrow("Wallet hierarchy could not be verified")
    await expect(result).rejects.not.toBeInstanceOf(GatewayWalletFrozenError)
  })

  it.each([{ chain: [] }, { chain: [{ ...CHAIN[0], id: "wrong-wallet" }] }])("rejects missing or mismatched ancestry", async ({ chain }) => {
    ancestors = chain
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Incomplete wallet ancestry")
  })

  it("rejects ancestry changes while acquiring its locks", async () => {
    afterLocks = () => {
      ancestors = [{ ...CHAIN[0], parentId: "new-root" }, { ...CHAIN[0], id: "new-root" }]
    }
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("ancestry changed")
  })

  it("rejects a subtree truncated by the node limit", async () => {
    ancestors = [{ ...CHAIN[0], policyId: "policy-1", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 }]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: AGENT.walletId, walletIds: Array.from({ length: 500 }, (_, i) => `wallet-${i}`) })
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("traversal limit")
  })

  it("does not admit against a subtree missing the caller's own wallet", async () => {
    ancestors = [{ ...CHAIN[0], policyId: "policy-1", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 }]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: AGENT.walletId, walletIds: [] })
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Incomplete token pool")
  })

  it("rejects a subtree with omitted descendants even when it contains the caller", async () => {
    ancestors = [{ ...CHAIN[0], policyId: "policy-1", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 }]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: AGENT.walletId, walletIds: [AGENT.walletId], incomplete: true })
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Incomplete token pool")
  })

  it.each(["agent", "pool"] as const)("fails closed when the occupancy snapshot omits the required %s scope", async (missing) => {
    if (missing === "agent") occupancy = []
    else ancestors = [{ ...CHAIN[0], policyId: "policy-1", perTransactionMaxUsd: 0, subtreeDailyTokenCapUsd: 1000 }]
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow(missing === "agent" ? "Incomplete agent token budget snapshot" : "Incomplete token pool")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("propagates a failed reservation commit without returning authority to call upstream", async () => {
    dbMock.gatewayReservation.create.mockRejectedValue(new Error("database unavailable"))
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("database unavailable")
  })

  it("rejects non-finite persisted occupancy rather than admitting through a failed comparison", async () => {
    occupancy[0].dailyLogs = Number.NaN
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("Invalid token cost")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
  })

  it("uses the post-lock day for admission and explicit log timestamps when a wait crosses midnight", async () => {
    vi.useFakeTimers()
    try {
      const afterMidnight = new Date(2026, 10, 19, 0, 0, 1)
      vi.setSystemTime(new Date(2026, 10, 18, 23, 59, 59))
      afterLocks = () => { vi.setSystemTime(afterMidnight) }
      await reserveGatewayBudget(AGENT, INPUT)
      await recordTokenUsageUnderBudget(AGENT, { ...USAGE, costUsd: 0.018 })
      await resolveGatewayBudget(reservation.id, USAGE, true)
      expect(dbMock.gatewayReservation.create.mock.calls[0][0].data.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.create.mock.calls[0][0].data.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.upsert.mock.calls[0][0].create.createdAt).toEqual(afterMidnight)
      expect(dbMock.tokenLog.upsert.mock.calls[0][0].update.createdAt).toEqual(afterMidnight)
      expect(statements.filter(({ kind }) => kind === "occupancy").map(({ values }) => values.filter((value) => value instanceof Date))).toEqual([
        [new Date(2026, 10, 19), new Date(2026, 10, 1), new Date(2026, 10, 19), new Date(2026, 10, 19), new Date(2026, 10, 19)],
        [new Date(2026, 10, 19), new Date(2026, 10, 1), new Date(2026, 10, 19), new Date(2026, 10, 19), new Date(2026, 10, 19)],
      ])
      expect(dbMock.$transaction.mock.calls.map((call) => call[1])).toEqual(Array(3).fill({ isolationLevel: "ReadCommitted" }))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("gateway budget denial receipts", () => {
  it.each(["daily", "monthly", "subtree-daily"] as const)("records a terminal %s denial in the existing audit stream", async (horizon) => {
    const receipt = await recordGatewayBudgetDenial(AGENT, {
      provider: "anthropic", model: "claude-sonnet-4", path: "v1/messages", requestedUsd: 1,
      verdict: { exhausted: true, spent: 9.5, budget: 10, horizon, capWalletId: "parent" },
    })
    expect(receipt).toBe("denial-1")
    const row = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(row).toMatchObject({
      agentId: AGENT.id, kind: "tool", action: "invoke", amountUsd: 0, status: "denied",
      merchant: "gateway:anthropic:claude-sonnet-4", category: "gateway",
      createdAt: expect.any(Date), decidedAt: expect.any(Date),
      detailsJson: {
        source: "gateway", code: "GATEWAY_BUDGET_EXCEEDED", wallet_id: AGENT.walletId,
        provider: "anthropic", model: "claude-sonnet-4", path: "v1/messages", horizon,
        limit_usd: 10, occupied_usd: 9.5, requested_reservation_usd: 1, cap_wallet_id: "parent",
      },
    })
    expect(row.decisionNote).toBe(`Gateway token budget exceeded: ${horizon}; provider=anthropic; model=claude-sonnet-4; limit_usd=10; occupied_usd=9.5; requested_reservation_usd=1`)
    expect(row.decisionContextJson).toBeUndefined()
    expect(decisionCode(row.status, row.decisionNote)).toBe("POLICY_DENIED")
  })

  it("supports a non-generating budget check without inventing a model or requested charge", async () => {
    await recordGatewayBudgetDenial(AGENT, { provider: "anthropic", verdict: { exhausted: true, spent: 10, budget: 10 } })
    expect(dbMock.authorizationRequest.create.mock.calls[0][0].data.detailsJson).toMatchObject({
      model: "not-applicable", path: null, horizon: "daily", requested_reservation_usd: null, cap_wallet_id: null,
    })
  })

  it.each([{ exhausted: false, budget: 10 }, { exhausted: true, budget: null }])("refuses a receipt without a concrete denial", async (verdict) => {
    await expect(recordGatewayBudgetDenial(AGENT, { provider: "anthropic", verdict: { ...verdict, spent: 0 } })).rejects.toThrow("requires an exhausted budget")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("fails admission closed if its denial receipt cannot be durably stored", async () => {
    occupancy[0].holds = [10]
    dbMock.authorizationRequest.create.mockRejectedValue(new Error("receipt write failed"))
    await expect(reserveGatewayBudget(AGENT, INPUT)).rejects.toThrow("receipt write failed")
    expect(dbMock.gatewayReservation.create).not.toHaveBeenCalled()
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
