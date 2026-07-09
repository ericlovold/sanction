import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// POST /tokens must enforce the SAME token horizons as the gateway wall — seat
// daily, opt-in seat monthly, and pooled subtree-daily — so an agent logging
// via /tokens (or MCP sanction_log_tokens) cannot outspend a cap its writes
// still drain for gateway siblings.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    wallet: { findUnique: vi.fn() },
    tokenLog: { create: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }))
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn(async () => {}) }))
vi.mock("@/lib/freeze", async (orig) => {
  const mod = await orig<typeof import("@/lib/freeze")>()
  return { ...mod, walletFreezeState: vi.fn(async () => ({ frozen: false })) }
})
vi.mock("@/lib/cascadeBudget", () => ({ walletAncestorChain: vi.fn(async () => []) }))
vi.mock("@/lib/poolAccess", () => ({ walletSubtreeIds: vi.fn(async () => []) }))

import { POST as logTokens } from "../app/api/v1/tokens/route"
import { walletAncestorChain } from "../lib/cascadeBudget"
import { walletSubtreeIds } from "../lib/poolAccess"

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
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
  vi.mocked(walletAncestorChain).mockResolvedValue([])
  vi.mocked(walletSubtreeIds).mockResolvedValue([])
})

describe("/tokens — daily horizon (unchanged)", () => {
  it("402s daily when this log would cross the seat daily budget", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 9.99 } }) // 9.99 + 0.05 > 10
    const res = await logTokens(reqTokens(USAGE))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(body.horizon).toBe("daily")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })
})

describe("/tokens — monthly horizon (opt-in)", () => {
  it("402s monthly when under the day but over the seat monthly budget", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, monthlyTokenBudgetUsd: 500 }) // $5/mo override
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce({ _sum: { costUsd: 1 } }) // today: fine
      .mockResolvedValueOnce({ _sum: { costUsd: 4.99 } }) // month: 4.99 + 0.05 > 5
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
    vi.mocked(walletAncestorChain).mockResolvedValue([
      { id: "org_1", parentId: null, policy: { subtreeDailyTokenCapUsd: 50_000 } }, // $500 dept cap
    ] as never)
    vi.mocked(walletSubtreeIds).mockResolvedValue(["org_1", WID])
    dbMock.tokenLog.aggregate
      .mockResolvedValueOnce({ _sum: { costUsd: 2 } }) // seat's own day: fine
      .mockResolvedValueOnce({ _sum: { costUsd: 499.99 } }) // subtree: 499.99 + 0.05 > 500
    const res = await logTokens(reqTokens(USAGE))
    const body = await res.json()
    expect(res.status).toBe(402)
    expect(body.horizon).toBe("subtree-daily")
    expect(body.cap_wallet_id).toBe("org_1")
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })

  it("records normally when every horizon has headroom", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 1 } })
    const res = await logTokens(reqTokens(USAGE))
    expect(res.status).toBe(200)
    expect(dbMock.tokenLog.create).toHaveBeenCalled()
  })
})
