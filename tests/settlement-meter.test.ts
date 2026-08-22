import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// STABLE-0 + MONO-0: settlement metadata rides the spend row (inert to the
// decision), and the decision meter counts fresh engine decisions — never
// idempotent replays. after() is unwrapped to run inline here so the meter's
// fire-and-forget increments are observable.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    executionToken: { findUnique: vi.fn(), update: vi.fn() },
    pendingApproval: { findFirst: vi.fn() },
    walletDecisionCounter: { upsert: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: (fn: () => unknown) => void fn() }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${encodeURIComponent(id)}` : ""}` }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/thresholds", () => ({
  notifySpendBudgetThreshold: vi.fn(async () => {}),
  notifyPoolCapThresholds: vi.fn(async () => {}),
}))
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return { ...mod, createSpendPendingApproval: vi.fn(async () => ({ id: "pa_1" })) }
})
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return {
    ...mod,
    walletAncestorChain: vi.fn(async () => []),
    reserveCascadeDailySpend: vi.fn(async () => []),
    cascadeDailyWouldExceed: vi.fn(async () => false),
  }
})

import { POST as authorize } from "../app/api/v1/authorize/route"
import { settlementSchema } from "../lib/settlement"
import { monthUtc, recordDecision, decisionsThisMonth } from "../lib/decisionMeter"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"

const POLICY = {
  id: "pol_1",
  walletId: WID,
  dailyTokenBudgetUsd: 1000,
  dailySpendBudgetUsd: 1_000_000,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: ["gambling"],
  allowedTools: [],
  blockedTools: [],
  escalateTools: [],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
}

const AGENT = {
  id: "agent_1",
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: POLICY },
}

function req(body: unknown, opts: { idempotencyKey?: string; simulate?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": KEY }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey
  const url = "https://test.local/api/v1/authorize" + (opts.simulate ? "?simulate=true" : "")
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) })
}

const SPEND = { action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software" }

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 0 } })
  dbMock.authorizationRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_1",
    createdAt: new Date(),
    decidedAt: null,
    decisionNote: null,
    ...data,
  }))
  dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "pa_1", actionType: "spend.purchase", resourceJson: {}, reason: "r" })
  dbMock.walletDecisionCounter.upsert.mockResolvedValue({})
  dbMock.walletDecisionCounter.aggregate.mockResolvedValue({ _sum: { count: 0 } })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

describe("settlementSchema — closed vocabulary (STABLE-0)", () => {
  it("accepts the x402/usdc/base triple", () => {
    expect(settlementSchema.safeParse({ rail: "x402", asset: "usdc", network: "base" }).success).toBe(true)
  })

  it("accepts a bare card rail", () => {
    expect(settlementSchema.safeParse({ rail: "card" }).success).toBe(true)
  })

  it("rejects an unknown rail — closed means closed", () => {
    expect(settlementSchema.safeParse({ rail: "carrier-pigeon" }).success).toBe(false)
  })

  it("rejects a chain network on a non-x402 rail (evidence must not lie)", () => {
    expect(settlementSchema.safeParse({ rail: "card", network: "base" }).success).toBe(false)
  })
})

describe("authorize — settlement rides the row, inert to the decision", () => {
  it("persists settlement in detailsJson and still approves under the floor", async () => {
    const res = await authorize(req({ ...SPEND, settlement: { rail: "x402", asset: "usdc", network: "base" } }))
    expect(res.status).toBe(200)
    expect((await res.json()).authorized).toBe(true)
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          detailsJson: expect.objectContaining({ settlement: { rail: "x402", asset: "usdc", network: "base" } }),
        }),
      }),
    )
  })

  it("400s an off-vocabulary settlement before any decision", async () => {
    const res = await authorize(req({ ...SPEND, settlement: { rail: "paypal" } }))
    expect(res.status).toBe(400)
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
    expect(dbMock.walletDecisionCounter.upsert).not.toHaveBeenCalled()
  })
})

describe("decision meter (MONO-0)", () => {
  it("increments once for a fresh approval", async () => {
    await authorize(req(SPEND))
    expect(dbMock.walletDecisionCounter.upsert).toHaveBeenCalledTimes(1)
    const arg = dbMock.walletDecisionCounter.upsert.mock.calls[0][0]
    expect(arg.where.walletId_month).toEqual({ walletId: WID, month: monthUtc() })
    expect(arg.update).toEqual({ count: { increment: 1 } })
  })

  it("increments once for a fresh denial (deny is a decision too)", async () => {
    await authorize(req({ ...SPEND, category: "gambling" }))
    expect(dbMock.walletDecisionCounter.upsert).toHaveBeenCalledTimes(1)
  })

  it("never counts an idempotent replay", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_prior",
      status: "approved",
      decisionNote: null,
      amountUsd: 5,
      merchant: "Anthropic",
      createdAt: new Date(),
    })
    const res = await authorize(req(SPEND, { idempotencyKey: "idem-1" }))
    expect(res.status).toBe(200)
    expect(dbMock.walletDecisionCounter.upsert).not.toHaveBeenCalled()
  })

  it("never counts a simulate run", async () => {
    const res = await authorize(req(SPEND, { simulate: true }))
    expect(res.status).toBe(200)
    expect(dbMock.walletDecisionCounter.upsert).not.toHaveBeenCalled()
  })

  it("recordDecision swallows meter failures — metering can never fail the path", async () => {
    dbMock.walletDecisionCounter.upsert.mockRejectedValueOnce(new Error("db down"))
    await expect(recordDecision(WID)).resolves.toBeUndefined()
  })

  it("decisionsThisMonth sums the scope for the current UTC month", async () => {
    dbMock.walletDecisionCounter.aggregate.mockResolvedValueOnce({ _sum: { count: 42 } })
    await expect(decisionsThisMonth(["w1", "w2"])).resolves.toBe(42)
    expect(dbMock.walletDecisionCounter.aggregate).toHaveBeenCalledWith({
      where: { walletId: { in: ["w1", "w2"] }, month: monthUtc() },
      _sum: { count: true },
    })
  })

  it("monthUtc keys by UTC, zero-padded", () => {
    expect(monthUtc(new Date(Date.UTC(2026, 0, 3)))).toBe("2026-01")
    expect(monthUtc(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe("2026-12")
  })
})
