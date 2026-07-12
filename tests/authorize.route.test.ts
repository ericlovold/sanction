import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests for POST /v1/authorize — the core spend authorization
// endpoint. Mirrors tests/provision.route.test.ts (the provision route was built
// from this route's template): auth gate, validation, the ladder, budgets,
// idempotency, simulate (FUND-1), and the execution-token binding (SEC-5).
// Concurrency/atomicity is proven in concurrency.db.test.ts against real Postgres.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    executionToken: { findUnique: vi.fn(), update: vi.fn() },
    pendingApproval: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${id}` : ""}` }))
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
vi.mock("@/lib/grants", async (orig) => {
  const mod = await orig<typeof import("@/lib/grants")>()
  return { ...mod, consumeSpendGrant: vi.fn() }
})

import { POST as authorize } from "../app/api/v1/authorize/route"
import { createSpendPendingApproval } from "../lib/approvals"
import { issueExecutionJWT } from "../lib/jwt"
import { cascadeDailyWouldExceed } from "../lib/cascadeBudget"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const AID = "agent_1"

// Bands (cents): auto-approve < $10, escalate > $50, hard cap $100.
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
  id: AID,
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

function req(body: unknown, opts: { key?: string | null; idempotencyKey?: string; simulate?: boolean; bearer?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`
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
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
  vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(false)
})

describe("authorize — gates before the engine", () => {
  it("401 without an API key", async () => {
    expect((await authorize(req(SPEND, { key: null }))).status).toBe(401)
  })

  it("400 on an unknown action", async () => {
    expect((await authorize(req({ ...SPEND, action: "gamble" }))).status).toBe(400)
  })

  it("denies and persists NO_POLICY when the wallet has no policy (fail closed)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const res = await authorize(req(SPEND))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("NO_POLICY")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied" }) }),
    )
  })

  it("denies a blocked category and persists the denial", async () => {
    const res = await authorize(req({ ...SPEND, category: "gambling" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.status).toBe("denied")
    expect(body.code).toBe("CATEGORY_BLOCKED")
  })
})

describe("authorize — the spend ladder", () => {
  it("auto-approves under the floor", async () => {
    const res = await authorize(req(SPEND)) // $5 < $10
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ authorized: true, status: "approved" })
  })

  it("escalates between the threshold and the hard cap, creating the pending approval", async () => {
    const res = await authorize(req({ ...SPEND, amount_usd: 60 })) // $50 < $60 ≤ $100
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: false, status: "escalated" })
    expect(createSpendPendingApproval).toHaveBeenCalledOnce()
  })

  it("denies over the per-transaction hard cap", async () => {
    const res = await authorize(req({ ...SPEND, amount_usd: 150 })) // > $100
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("PER_TXN_LIMIT")
  })

  it("denies when the daily spend budget is exhausted", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, dailySpendBudgetUsd: 1_000 } }, // $10/day
    })
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 8 } })
    const res = await authorize(req(SPEND)) // 8 + 5 > 10
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("DAILY_BUDGET_EXCEEDED")
  })

  it("denies when the monthly cap is exhausted even though the day is clear", async () => {
    // Monthly cap $800; month-to-date $798. Daily budget is untouched ($10k).
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, monthlySpendBudgetUsd: 80_000 } },
    })
    // Both the daily and monthly aggregate reads resolve to the same month total.
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 798 } })
    const res = await authorize(req(SPEND)) // $798 + $5 > $800 monthly, but « $10k daily
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MONTHLY_BUDGET_EXCEEDED")
  })

  it("honors a tighter per-agent per-transaction override", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, perTransactionMaxUsd: 300 }) // $3
    const res = await authorize(req(SPEND)) // $5 > $3
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("PER_TXN_LIMIT")
  })
})

describe("authorize — idempotency + simulate (FUND-1)", () => {
  it("replays the stored decision for a repeated Idempotency-Key", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_prev", status: "approved", decisionNote: "Auto-approved", amountUsd: 5, merchant: "Anthropic",
    })
    const res = await authorize(req(SPEND, { idempotencyKey: "idem-1" }))
    expect(res.status).toBe(200)
    expect((await res.json()).request_id).toBe("req_prev")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulate returns the decision and persists nothing", async () => {
    const res = await authorize(req(SPEND, { simulate: true }))
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ simulated: true, authorized: true, request_id: null })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulate preserves policy-deny precedence ahead of subtree caps", async () => {
    vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(true)
    const res = await authorize(req({ ...SPEND, category: "gambling" }, { simulate: true }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ simulated: true, status: "denied", code: "CATEGORY_BLOCKED" })
    expect(cascadeDailyWouldExceed).not.toHaveBeenCalled()
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulate honors execution-token budget state without persisting", async () => {
    const { jwt, jti } = await issueExecutionJWT({ agent: AID, wallet: WID, scope: [], budget_usd: 10, clearance: 1 })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti, status: "active", expiresAt: new Date(Date.now() + 60_000), spentUsd: 9, budgetUsd: 10,
    })

    const res = await authorize(req(SPEND, { simulate: true, bearer: jwt }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ simulated: true, status: "denied", code: "EXEC_BUDGET_EXCEEDED" })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
    expect(dbMock.executionToken.update).not.toHaveBeenCalled()
  })
})

describe("authorize — execution-token binding (SEC-5)", () => {
  it("401 on a garbage execution token", async () => {
    const res = await authorize(req(SPEND, { bearer: "not-a-jwt" }))
    expect(res.status).toBe(401)
  })

  it("403 when the execution token belongs to a different agent", async () => {
    const { jwt } = await issueExecutionJWT({ agent: "agent_other", wallet: WID, scope: [], budget_usd: 10, clearance: 1 })
    const res = await authorize(req(SPEND, { bearer: jwt }))
    expect(res.status).toBe(403)
  })

  it("enforces the execution budget: a spend past the exec cap does not auto-approve", async () => {
    const { jwt, jti } = await issueExecutionJWT({ agent: AID, wallet: WID, scope: [], budget_usd: 10, clearance: 1 })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti, status: "active", expiresAt: new Date(Date.now() + 60_000), spentUsd: 9, budgetUsd: 10,
    })
    const res = await authorize(req(SPEND, { bearer: jwt })) // $9 spent + $5 > $10 exec budget
    const body = await res.json()
    expect(body.authorized).toBe(false)
    expect(["denied", "escalated"]).toContain(body.status)
  })
})

describe("authorize — attribution tags", () => {
  it("persists tags into detailsJson on an approved spend", async () => {
    const tags = { channel: "paid-media", play: "d2c-search" }
    const res = await authorize(req({ ...SPEND, tags }))
    expect(res.status).toBe(200)
    const created = dbMock.authorizationRequest.create.mock.calls.at(-1)?.[0].data
    expect(created.detailsJson).toEqual({ tags })
  })

  it("leaves detailsJson unset when no tags are sent", async () => {
    const res = await authorize(req(SPEND))
    expect(res.status).toBe(200)
    const created = dbMock.authorizationRequest.create.mock.calls.at(-1)?.[0].data
    expect(created.detailsJson).toBeUndefined()
  })

  it("400 on more than 8 tags", async () => {
    const tags = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"]))
    expect((await authorize(req({ ...SPEND, tags }))).status).toBe(400)
  })

  it("400 on non-string tag values and oversized values", async () => {
    expect((await authorize(req({ ...SPEND, tags: { n: 42 } }))).status).toBe(400)
    expect((await authorize(req({ ...SPEND, tags: { k: "x".repeat(81) } }))).status).toBe(400)
  })
})
