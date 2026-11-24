// Token budget horizons at the gateway wall: seat daily, seat monthly (opt-in),
// and pooled subtree daily caps up the wallet tree. Exercises the REAL
// isBudgetExhausted against a mocked db.
import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMock = vi.hoisted(() => ({
  tokenLog: { aggregate: vi.fn() },
  wallet: { findUnique: vi.fn(), findMany: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { isBudgetExhausted } from "../lib/gateway"

type AgentInput = Parameters<typeof isBudgetExhausted>[0]

const agent = (over: Partial<AgentInput> = {}): AgentInput => ({
  id: "seat-1",
  walletId: "pool-1",
  isActive: true,
  dailyTokenBudgetUsd: 1000, // $10
  monthlyTokenBudgetUsd: null,
  wallet: { policy: { dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: null } },
  ...over,
})

const sum = (usd: number) => ({ _sum: { costUsd: usd } })

/** Chain fetch: findUnique per ancestor, root first param call order is child-up. */
function mockChain(nodes: Array<{
  id: string; parentId: string | null; tokenCapCents: number | null
  /** Omit for a wallet with a policy and no model defaults in the fixture; null for a wallet with no policy. */
  model?: { daily: number; monthly?: number | null } | null
}>) {
  for (const n of nodes) {
    dbMock.wallet.findUnique.mockResolvedValueOnce({
      id: n.id,
      parentId: n.parentId,
      frozenAt: null,
      frozenReason: null,
      policy: n.model === null ? null : {
        perTransactionMaxUsd: 5000, subtreeDailyCapUsd: null, subtreeDailyTokenCapUsd: n.tokenCapCents,
        dailyTokenBudgetUsd: n.model?.daily, monthlyTokenBudgetUsd: n.model?.monthly ?? null,
      },
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Subtree BFS: no children unless a test overrides.
  dbMock.wallet.findMany.mockResolvedValue([])
})

describe("seat daily budget", () => {
  it("exhausts exactly at the boundary (spent == budget)", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(10))
    const v = await isBudgetExhausted(agent())
    expect(v).toMatchObject({ exhausted: true, horizon: "daily", spent: 10, budget: 10 })
    // Short-circuits before any ancestor work.
    expect(dbMock.wallet.findUnique).not.toHaveBeenCalled()
  })

  it("passes under the line and reports daily spend", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(9.99))
    mockChain([{ id: "pool-1", parentId: null, tokenCapCents: null }])
    const v = await isBudgetExhausted(agent())
    expect(v).toMatchObject({ exhausted: false, spent: 9.99, budget: 10 })
  })

  it("agent override beats the wallet default", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(3))
    const v = await isBudgetExhausted(agent({ dailyTokenBudgetUsd: 300 })) // $3 override
    expect(v).toMatchObject({ exhausted: true, horizon: "daily", budget: 3 })
  })
})

describe("a group with no policy inherits per-agent model limits", () => {
  const unruled = () => agent({ walletId: "team", dailyTokenBudgetUsd: null, wallet: { policy: null } })

  it("stops at the parent's daily default (before: no per-agent limit at all)", async () => {
    mockChain([
      { id: "team", parentId: "org", tokenCapCents: null, model: null },
      { id: "org", parentId: null, tokenCapCents: null, model: { daily: 500 } },
    ])
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(5))
    expect(await isBudgetExhausted(unruled())).toMatchObject({ exhausted: true, horizon: "daily", spent: 5, budget: 5 })
  })

  it("stops at the parent's monthly default", async () => {
    mockChain([
      { id: "team", parentId: "org", tokenCapCents: null, model: null },
      { id: "org", parentId: null, tokenCapCents: null, model: { daily: 500, monthly: 2000 } },
    ])
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(1)).mockResolvedValueOnce(sum(20))
    expect(await isBudgetExhausted(unruled())).toMatchObject({ exhausted: true, horizon: "monthly", budget: 20 })
  })

  it("passes under the inherited line and walks the chain once", async () => {
    mockChain([
      { id: "team", parentId: "org", tokenCapCents: null, model: null },
      { id: "org", parentId: null, tokenCapCents: null, model: { daily: 500 } },
    ])
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(4.99))
    expect(await isBudgetExhausted(unruled())).toMatchObject({ exhausted: false, spent: 4.99, budget: 5 })
    expect(dbMock.wallet.findUnique).toHaveBeenCalledTimes(2)
  })

  it("the agent's own limit still beats the inherited default", async () => {
    mockChain([
      { id: "team", parentId: "org", tokenCapCents: null, model: null },
      { id: "org", parentId: null, tokenCapCents: null, model: { daily: 500 } },
    ])
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(6))
    expect(await isBudgetExhausted({ ...unruled(), dailyTokenBudgetUsd: 1000 })).toMatchObject({ exhausted: false, budget: 10 })
  })

  it("stays unlimited per agent when no wallet up the tree has a policy", async () => {
    mockChain([
      { id: "team", parentId: "org", tokenCapCents: null, model: null },
      { id: "org", parentId: null, tokenCapCents: null, model: null },
    ])
    expect(await isBudgetExhausted(unruled())).toMatchObject({ exhausted: false, budget: null })
    expect(dbMock.tokenLog.aggregate).not.toHaveBeenCalled()
  })
})

describe("seat monthly budget (opt-in)", () => {
  it("skips entirely when neither agent nor policy sets it", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValueOnce(sum(1)) // daily only
    mockChain([{ id: "pool-1", parentId: null, tokenCapCents: null }])
    await isBudgetExhausted(agent())
    expect(dbMock.tokenLog.aggregate).toHaveBeenCalledTimes(1)
  })

  it("exhausts on the policy monthly line after daily passes", async () => {
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce(sum(1)) // today
      .mockResolvedValueOnce(sum(50)) // month-to-date
    const v = await isBudgetExhausted(
      agent({ wallet: { policy: { dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: 5000 } } }), // $50/mo
    )
    expect(v).toMatchObject({ exhausted: true, horizon: "monthly", spent: 50, budget: 50 })
  })

  it("agent monthly override wins over the policy value", async () => {
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce(sum(1)) // today
      .mockResolvedValueOnce(sum(20)) // month-to-date
    const v = await isBudgetExhausted(
      agent({
        monthlyTokenBudgetUsd: 2000, // $20 override
        wallet: { policy: { dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: 900000 } },
      }),
    )
    expect(v).toMatchObject({ exhausted: true, horizon: "monthly", budget: 20 })
  })
})

describe("pooled subtree daily token cap", () => {
  it("hard-stops the whole channel even when the seat itself is under budget", async () => {
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce(sum(2)) // seat's own day: fine
      .mockResolvedValueOnce(sum(500)) // subtree sum: at the $500 dept cap
    mockChain([
      { id: "pool-1", parentId: "org-1", tokenCapCents: null },
      { id: "org-1", parentId: null, tokenCapCents: 50000 }, // $500 dept cap on the ancestor
    ])
    dbMock.wallet.findMany.mockResolvedValueOnce([{ id: "pool-1", parentId: "org-1" }]).mockResolvedValueOnce([])
    // subtree BFS root lookup
    dbMock.wallet.findUnique.mockResolvedValueOnce({ id: "org-1" })

    const v = await isBudgetExhausted(agent())
    expect(v).toMatchObject({ exhausted: true, horizon: "subtree-daily", budget: 500, capWalletId: "org-1" })
  })

  it("passes when the subtree is under every ancestor cap", async () => {
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce(sum(2)) // seat day
      .mockResolvedValueOnce(sum(120)) // subtree sum under $500
    mockChain([
      { id: "pool-1", parentId: "org-1", tokenCapCents: null },
      { id: "org-1", parentId: null, tokenCapCents: 50000 },
    ])
    dbMock.wallet.findUnique.mockResolvedValueOnce({ id: "org-1" })

    const v = await isBudgetExhausted(agent())
    expect(v.exhausted).toBe(false)
  })
})
