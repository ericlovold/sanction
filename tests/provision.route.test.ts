import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests for POST /v1/authorize/provision with a mocked Prisma
// client — the unit-level regression net for the provision decision surface
// (auth gate, input validation, resource gates, dollar ladder, idempotency,
// simulate, grant consumption). Atomicity under concurrency and the approval
// inbox round-trip are proven separately in the DB-gated e2e/concurrency tests.
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
// after() only runs in a real request scope; side-effect fan-out is not under test.
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve" }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/thresholds", () => ({
  notifySpendBudgetThreshold: vi.fn(async () => {}),
  notifyPoolCapThresholds: vi.fn(async () => {}),
}))
// Pending-approval creation has its own unit tests; here we only assert it fires.
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return { ...mod, createProvisionPendingApproval: vi.fn(async () => ({ id: "pa_1" })) }
})
// Cascade math is proven in cascadeBudget.test.ts; stub only the db-touching fns
// (no ancestors, no subtree caps) and keep the pure helpers real.
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
  return { ...mod, consumeProvisionGrant: vi.fn() }
})

import { POST as provision } from "../app/api/v1/authorize/provision/route"
import { createProvisionPendingApproval } from "../lib/approvals"
import { consumeProvisionGrant } from "../lib/grants"
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
  blockedResources: ["aws:root-account"],
  escalateResources: ["azure:seat:premium"],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
}

const AGENT = {
  id: AID,
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(), // fresh — keeps the fire-and-forget lastUsed stamp quiet
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
  const url = "https://test.local/api/v1/authorize/provision" + (opts.simulate ? "?simulate=true" : "")
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) })
}

const SEATS = { resource: "azure:seat", line_item: "Microsoft 365 E3", quantity: 2, amount_usd: 5, category: "software" }

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
  dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "pa_1", actionType: "provision.allocate", resourceJson: {}, reason: "r" })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
  vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(false)
})

describe("provision route — gates before the engine", () => {
  it("401 without an API key", async () => {
    const res = await provision(req(SEATS, { key: null }))
    expect(res.status).toBe(401)
  })

  it("400 on a malformed body (missing line_item)", async () => {
    const res = await provision(req({ resource: "azure:seat", quantity: 1, amount_usd: 5, category: "software" }))
    expect(res.status).toBe(400)
  })

  it("400 AMOUNT_MISMATCH when quantity × unit_price ≠ amount (agent arithmetic error, not policy)", async () => {
    const res = await provision(req({ ...SEATS, unit_price_usd: 3 })) // 2 × $3 ≠ $5
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("AMOUNT_MISMATCH")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("400 when simulate=true is combined with grant_id", async () => {
    const res = await provision(req({ ...SEATS, grant_id: "grant_1" }, { simulate: true }))
    expect(res.status).toBe(400)
  })

  it("denies and persists NO_POLICY when the wallet has no policy (fail closed)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const res = await provision(req(SEATS))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.status).toBe("denied")
    expect(body.code).toBe("NO_POLICY")
    // The denial is still an audit row — every decision leaves a trace.
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "provision", status: "denied" }) }),
    )
  })
})

describe("provision route — resource gates (deny overrides, escalate short-circuits the ladder)", () => {
  it("denies a blocked resource and persists the denial", async () => {
    const res = await provision(req({ ...SEATS, resource: "aws:root-account" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("RESOURCE_BLOCKED")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied", merchant: "aws:root-account" }) }),
    )
  })

  it("denies a resource outside a non-empty allow-list", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, allowedResources: ["azure:seat"] } },
    })
    const res = await provision(req({ ...SEATS, resource: "gcp:project" }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("RESOURCE_NOT_ALLOWED")
  })

  it("escalates an escalate-listed resource regardless of amount, creating the pending approval", async () => {
    const res = await provision(req({ ...SEATS, resource: "azure:seat:premium", amount_usd: 1 })) // far under the floor
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("escalated")
    expect(body.authorized).toBe(false)
    expect(body.code).toBe("ESCALATION_REQUIRED")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "escalated" }) }),
    )
    expect(createProvisionPendingApproval).toHaveBeenCalledOnce()
  })
})

describe("provision route — the dollar ladder (shared with spend)", () => {
  it("auto-approves under the floor and persists the approval with provision details", async () => {
    const res = await provision(req(SEATS)) // $5 < $10 floor
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "approved", resource: "azure:seat", line_item: "Microsoft 365 E3", quantity: 2 })
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "provision",
          action: "allocate",
          status: "approved",
          detailsJson: expect.objectContaining({ line_item: "Microsoft 365 E3", quantity: 2 }),
        }),
      }),
    )
  })

  it("escalates between the escalation threshold and the hard cap", async () => {
    const res = await provision(req({ ...SEATS, amount_usd: 60 })) // $50 < $60 ≤ $100
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("escalated")
    expect(createProvisionPendingApproval).toHaveBeenCalledOnce()
  })

  it("denies over the per-transaction hard cap", async () => {
    const res = await provision(req({ ...SEATS, amount_usd: 150 })) // > $100 cap
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.status).toBe("denied")
    expect(body.code).toBe("PER_TXN_LIMIT")
  })

  it("denies when the daily spend budget is exhausted (state read under the lock)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, dailySpendBudgetUsd: 1_000 } }, // $10/day
    })
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 8 } }) // $8 already approved today
    const res = await provision(req(SEATS)) // +$5 would blow the $10 budget
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("DAILY_BUDGET_EXCEEDED")
  })

  it("honors per-agent overrides ahead of the wallet policy (tighter per-txn cap)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, perTransactionMaxUsd: 300 }) // $3 cap for this agent
    const res = await provision(req(SEATS)) // $5 > $3
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("PER_TXN_LIMIT")
  })
})

describe("provision route — idempotency", () => {
  it("replays the stored decision instead of re-deciding", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_prev",
      status: "approved",
      decisionNote: "Auto-approved",
      amountUsd: 5,
      merchant: "azure:seat",
      detailsJson: { line_item: "Microsoft 365 E3", quantity: 2, unit_price_usd: null },
    })
    const res = await provision(req(SEATS, { idempotencyKey: "idem-1" }))
    expect(res.status).toBe(200)
    expect((await res.json()).request_id).toBe("req_prev")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })
})

describe("provision route — simulate (decision-only, nothing persisted)", () => {
  it("returns the would-be decision and writes no rows", async () => {
    const res = await provision(req(SEATS, { simulate: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ simulated: true, authorized: true, status: "approved", request_id: null })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulates a denial for a blocked resource without persisting it", async () => {
    const res = await provision(req({ ...SEATS, resource: "aws:root-account" }, { simulate: true }))
    expect(res.status).toBe(403)
    expect((await res.json())).toMatchObject({ simulated: true, status: "denied" })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulate preserves resource-deny precedence ahead of subtree caps", async () => {
    vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(true)
    const res = await provision(req({ ...SEATS, resource: "aws:root-account" }, { simulate: true }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ simulated: true, status: "denied", code: "RESOURCE_BLOCKED" })
    expect(cascadeDailyWouldExceed).not.toHaveBeenCalled()
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("simulate honors execution-token budget state without persisting", async () => {
    const { jwt, jti } = await issueExecutionJWT({ agent: AID, wallet: WID, scope: [], budget_usd: 10, clearance: 1 })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti, status: "active", expiresAt: new Date(Date.now() + 60_000), spentUsd: 9, budgetUsd: 10,
    })

    const res = await provision(req(SEATS, { simulate: true, bearer: jwt }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ simulated: true, status: "denied", code: "EXEC_BUDGET_EXCEEDED" })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
    expect(dbMock.executionToken.update).not.toHaveBeenCalled()
  })
})

describe("provision route — grant consumption (pre-approved authority)", () => {
  it("consumes a valid grant and returns its consumption receipt", async () => {
    vi.mocked(consumeProvisionGrant).mockResolvedValue({
      ok: true,
      grantId: "grant_1",
      consumedAt: new Date("2026-07-02T00:00:00Z"),
      grantExpiresAt: null,
      request: { id: "req_g", status: "approved", decisionNote: "Consumed grant", amountUsd: 5, merchant: "azure:seat", detailsJson: {} },
    } as never)
    const res = await provision(req({ ...SEATS, grant_id: "grant_1" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "approved", grant_id: "grant_1", grant_status: "consumed" })
  })

  it("rejects an unusable grant with the resolver's code and status", async () => {
    vi.mocked(consumeProvisionGrant).mockResolvedValue({
      ok: false,
      code: "GRANT_CONSUMED",
      reason: "Grant already consumed",
      status: 409,
    } as never)
    const res = await provision(req({ ...SEATS, grant_id: "grant_1" }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: false, status: "denied", code: "GRANT_CONSUMED" })
  })
})
