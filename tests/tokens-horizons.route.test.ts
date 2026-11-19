import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"
import type { Prisma } from "../lib/generated/prisma/client"

// POST /tokens must enforce the SAME token horizons as the gateway wall — seat
// daily, opt-in seat monthly, and pooled subtree-daily — so an agent logging
// via /tokens (or MCP sanction_log_tokens) cannot outspend a cap its writes
// still drain for gateway siblings.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    tokenLog: { create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }))
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn(async () => {}) }))
vi.mock("@/lib/freeze", async (orig) => {
  const mod = await orig<typeof import("@/lib/freeze")>()
  return { ...mod, walletFreezeState: vi.fn(async () => ({ frozen: false })) }
})

import { POST as logTokens } from "../app/api/v1/tokens/route"
import { walletFreezeState } from "../lib/freeze"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const POLICY = { dailyTokenBudgetUsd: 1_000, monthlyTokenBudgetUsd: null, subtreeDailyTokenCapUsd: null } // $10/day
const AGENT = {
  id: "agent_1",
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  monthlyTokenBudgetUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "o@example.com", policy: POLICY },
}
const USAGE = { model: "claude", tokens_in: 100, tokens_out: 50, cost_usd: 0.05 }
type SnapshotFixture = {
  id: string; parentId: string | null; frozenAt: Date | null; frozenReason: string | null
  policyId: string | null; perTransactionMaxUsd: number | null
  subtreeDailyCapUsd: number | null; subtreeDailyTokenCapUsd: number | null
  policyDaily: number | null; policyMonthly: number | null
  seatId: string; seatWalletId: string; seatActive: boolean; seatExpiresAt: Date | null
  seatDaily: number | null; seatMonthly: number | null
}
type OccupancyFixture = {
  scopeId: string; kind: "agent" | "pool"; walletIds: string[]; incomplete: boolean
  dailyLogs: number; monthlyLogs: number; holds: number[]
}
const SNAPSHOT: SnapshotFixture = {
  id: WID, parentId: null, frozenAt: null, frozenReason: null,
  policyId: "policy_1", perTransactionMaxUsd: 0, subtreeDailyCapUsd: null, subtreeDailyTokenCapUsd: null,
  policyDaily: POLICY.dailyTokenBudgetUsd, policyMonthly: null,
  seatId: AGENT.id, seatWalletId: WID, seatActive: true, seatExpiresAt: null, seatDaily: null, seatMonthly: null,
}
const EMPTY_USAGE: OccupancyFixture = { scopeId: AGENT.id, kind: "agent", walletIds: [], incomplete: false, dailyLogs: 0, monthlyLogs: 0, holds: [] }
let snapshots: SnapshotFixture[]
let occupancy: OccupancyFixture[]

function reqTokens(body: unknown) {
  return new NextRequest("https://test.local/api/v1/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.tokenLog.create.mockResolvedValue({ id: "tl_1" })
  snapshots = [{ ...SNAPSHOT }]
  occupancy = [{ ...EMPTY_USAGE, holds: [] }]
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
  dbMock.$queryRaw.mockImplementation(async (query: Prisma.Sql | TemplateStringsArray) => {
    const sql = "sql" in query ? query.sql : query.join("?")
    if (sql.includes("WITH RECURSIVE ancestors AS")) return snapshots.map((row) => ({ ...row }))
    if (sql.includes("WITH scopes AS")) return occupancy
    throw new Error(`Unexpected token budget SQL: ${sql}`)
  })
  vi.mocked(walletFreezeState).mockResolvedValue({ frozen: false })
})

describe("/tokens — daily horizon (unchanged)", () => {
  it("402s daily when this log would cross the seat daily budget", async () => {
    occupancy[0].dailyLogs = 9.99 // 9.99 + 0.05 > 10
    const res = await logTokens(reqTokens(USAGE))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(body.horizon).toBe("daily")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })
})

describe("/tokens — monthly horizon (opt-in)", () => {
  it("402s monthly when under the day but over the seat monthly budget", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, monthlyTokenBudgetUsd: 500 }) // $5/mo override
    snapshots[0].seatMonthly = 500
    occupancy[0].dailyLogs = 1 // today: fine
    occupancy[0].monthlyLogs = 4.99 // month: 4.99 + 0.05 > 5
    const res = await logTokens(reqTokens(USAGE))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(body.horizon).toBe("monthly")
    expect(body.limit_usd).toBe(5)
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })
})

describe("/tokens — pooled subtree-daily horizon", () => {
  it("402s subtree-daily when the department pool cap would be crossed by siblings' combined spend", async () => {
    snapshots = [
      { ...SNAPSHOT, parentId: "org_1" },
      { ...SNAPSHOT, id: "org_1", policyId: "org_policy", subtreeDailyTokenCapUsd: 50_000 }, // $500 dept cap
    ]
    occupancy[0].dailyLogs = 2 // seat's own day: fine
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: "org_1", walletIds: ["org_1", WID], dailyLogs: 499.99 }) // subtree: 499.99 + 0.05 > 500
    const res = await logTokens(reqTokens(USAGE))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(body.horizon).toBe("subtree-daily")
    expect(body.cap_wallet_id).toBe("org_1")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })

  it("records normally when every horizon has headroom", async () => {
    occupancy[0].dailyLogs = 1
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(dbMock.tokenLog.create).toHaveBeenCalled()
  })
})

describe("/tokens — reservations share the budget", () => {
  it("counts an unresolved gateway call before accepting a self-reported log", async () => {
    occupancy[0].dailyLogs = 9
    occupancy[0].holds = [1] // Snapshot retains the $1 hold despite only $0.10 observed.
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(402)
    expect((await res.json()).spent_usd).toBe(10)
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
    const query = dbMock.$queryRaw.mock.calls.find(([sql]) => "sql" in sql && sql.sql.includes("WITH scopes AS"))![0] as Prisma.Sql
    expect(query.values).toContain(AGENT.id)
    expect(query.sql).toContain("r.status IN ('pending', 'uncertain')")
    expect(query.sql).toContain('GREATEST(r."reservedUsd", r."observedUsd")')
  })

  it("counts observed overruns instead of limiting a hold to its original estimate", async () => {
    occupancy[0].holds = [10] // Snapshot includes the $10 overrun on a $1 reservation.
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(402)
    expect((await res.json()).spent_usd).toBe(10)
  })

  it("enforces an ancestor cap even when the child has no local policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    snapshots = [
      { ...SNAPSHOT, parentId: "org_1", policyId: null, perTransactionMaxUsd: null, policyDaily: null },
      { ...SNAPSHOT, id: "org_1", policyId: "org_policy", subtreeDailyTokenCapUsd: 100 },
    ]
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: "org_1", walletIds: ["org_1", WID], holds: [1] })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(402)
    expect((await res.json()).horizon).toBe("subtree-daily")
    expect((dbMock.$executeRaw.mock.calls[0][0] as Prisma.Sql).values).toEqual([
      "token-budget:wallet:org_1", "token-budget:wallet:wallet_1", AGENT.id,
    ])
  })

  it("enforces an agent override even when its wallet has no policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, dailyTokenBudgetUsd: 1, wallet: { ...AGENT.wallet, policy: null } })
    snapshots[0] = { ...SNAPSHOT, policyId: null, perTransactionMaxUsd: null, policyDaily: null, seatDaily: 1 }
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(402)
    expect((await res.json()).horizon).toBe("daily")
  })

  it("fails closed when the ancestry walk is truncated", async () => {
    snapshots[0].parentId = "unresolved"
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "TOKEN_BUDGET_UNAVAILABLE" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })

  it("fails closed when the subtree walk omitted a descendant", async () => {
    snapshots[0].subtreeDailyTokenCapUsd = 100_000
    occupancy.push({ ...EMPTY_USAGE, kind: "pool", scopeId: WID, walletIds: [WID], incomplete: true })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "TOKEN_BUDGET_UNAVAILABLE" })
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })
})

describe("/tokens — verified freezes and unavailable state stay distinct", () => {
  it.each([false, true])("returns uncached 403 when a freeze appears under the budget lock (parent=%s)", async (parent) => {
    snapshots = parent
      ? [{ ...SNAPSHOT, parentId: "parent" }, { ...SNAPSHOT, id: "parent", policyId: "parent_policy" }]
      : [{ ...SNAPSHOT }]
    dbMock.$executeRaw.mockImplementationOnce(async () => {
      snapshots.at(-1)!.frozenAt = new Date()
      snapshots.at(-1)!.frozenReason = "Paused"
    })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "WALLET_FROZEN", error: parent ? "Parent wallet is frozen" : "Wallet is frozen" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })

  it("returns uncached 403 for an already frozen wallet", async () => {
    vi.mocked(walletFreezeState).mockResolvedValue({ frozen: true, frozenWalletId: WID, self: true, reason: null })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "WALLET_FROZEN" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("does not turn an unverified pre-check hierarchy into a frozen-policy denial", async () => {
    vi.mocked(walletFreezeState).mockResolvedValue({ frozen: true, frozenWalletId: WID, self: true, reason: null, unverified: true })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "TOKEN_BUDGET_UNAVAILABLE" })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("returns uncached unavailable state if the pre-check database read fails", async () => {
    vi.mocked(walletFreezeState).mockRejectedValue(new Error("database unavailable"))
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "TOKEN_BUDGET_UNAVAILABLE" })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("keeps transaction failures separate from verified freezes", async () => {
    dbMock.$transaction.mockRejectedValue(new Error("database unavailable"))
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "TOKEN_BUDGET_UNAVAILABLE" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })
})
