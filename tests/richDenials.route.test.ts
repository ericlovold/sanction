import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// UX-3: rich denials answer four questions — what happened (code), why
// (reason + the fired limit's live values), what changes the answer
// (resets_at, or the signed appeal offer), where is the evidence (links to
// the record and its replay). Covers the native spend wire, the AuthZEN
// wire, and the appeal round-trip from a hard denial into a real approval.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    executionToken: { findUnique: vi.fn() },
    pendingApproval: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
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
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return {
    ...mod,
    createSpendPendingApproval: vi.fn(async () => ({ id: "pa_1" })),
    createToolPendingApproval: vi.fn(async () => ({ id: "pa_1" })),
    createProvisionPendingApproval: vi.fn(async () => ({ id: "pa_1" })),
  }
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
import { createSpendPendingApproval } from "../lib/approvals"
import { POST as evaluation } from "../app/api/access/v1/evaluation/route"
import { POST as openAccessRequest } from "../app/api/access/v1/access-request/route"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const AID = "agent_1"

// Bands (cents): auto-approve < $10, escalate > $50, hard cap $100, daily $10k.
const POLICY = {
  id: "pol_1",
  walletId: WID,
  currentRevision: 1,
  dailyTokenBudgetUsd: 1000,
  dailySpendBudgetUsd: 1_000_000,
  monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: [],
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

function spendReq(amount_usd: number) {
  return new NextRequest("https://test.local/api/v1/authorize", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({ action: "purchase", amount_usd, merchant: "github", category: "software" }),
  })
}

function jsonReq(path: string, body: unknown) {
  return new NextRequest(`https://test.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
  })
}

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
  dbMock.pendingApproval.create.mockResolvedValue({ id: "pa_1" })
  dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "pa_1", actionType: "spend.purchase", resourceJson: {}, reason: "r" })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

describe("native spend denials answer the four questions", () => {
  it("per-transaction denial: code, fired limit, links, appeal offer", async () => {
    const res = await authorize(spendReq(150))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("PER_TXN_LIMIT") // what happened
    expect(body.limit).toEqual(expect.objectContaining({ kind: "per_transaction", limit_usd: 100, requested_usd: 150 })) // why
    expect(body.access_request.binding_token).toBeDefined() // what changes the answer
    expect(body.links.evidence).toBe("/api/v1/authorize/req_1/evidence") // where is the evidence
  })

  it("daily-budget denial carries used/remaining and resets_at", async () => {
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 9_999 } })
    const res = await authorize(spendReq(50))
    const body = await res.json()
    expect(body.code).toBe("DAILY_BUDGET_EXCEEDED")
    expect(body.limit.kind).toBe("daily_spend_budget")
    expect(body.limit.limit_usd).toBe(10_000)
    expect(body.limit.used_usd).toBe(9_999)
    expect(body.limit.remaining_usd).toBe(1)
    expect(new Date(body.limit.resets_at).getTime()).toBeGreaterThan(Date.now())
    expect(body.access_request).toBeDefined()
  })

  it("escalations carry the band, without an offer (they already sit in the inbox)", async () => {
    const escalated = await (await authorize(spendReq(60))).json()
    expect(escalated.status).toBe("escalated")
    expect(escalated.limit.kind).toBe("escalation_band")
    expect(escalated.access_request).toBeUndefined()
  })

  it("approvals carry links but no limit", async () => {
    const approved = await (await authorize(spendReq(5))).json()
    expect(approved.authorized).toBe(true)
    expect(approved.limit).toBeUndefined()
    expect(approved.links.record).toBe("/api/v1/authorize/req_1")
  })
})

describe("AuthZEN wire: appealable hard denials carry the offer", () => {
  it("budget denial gets access_request like escalations do", async () => {
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 9_999 } })
    const res = await evaluation(
      jsonReq("/api/access/v1/evaluation", {
        subject: { type: "agent", id: AID },
        action: { name: "purchase", properties: { amount_usd: 50, category: "software" } },
        resource: { type: "spend", id: "github" },
      }),
    )
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("DAILY_BUDGET_EXCEEDED")
    expect(body.context.access_request.binding_token).toBeDefined()
  })

  it("monthly-budget denial carries the offer too", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, dailySpendBudgetUsd: 10_000_000, monthlySpendBudgetUsd: 1_000_000 } },
    })
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 9_999 } })
    const res = await evaluation(
      jsonReq("/api/access/v1/evaluation", {
        subject: { type: "agent", id: AID },
        action: { name: "purchase", properties: { amount_usd: 50, category: "software" } },
        resource: { type: "spend", id: "github" },
      }),
    )
    const body = await res.json()
    expect(body.context.code).toBe("MONTHLY_BUDGET_EXCEEDED")
    expect(body.context.access_request.binding_token).toBeDefined()
  })
})

describe("appeal round-trip: hard denial → access request → pending approval", () => {
  it("the denial's binding token opens a real escalation", async () => {
    const denial = await (await authorize(spendReq(150))).json()
    const res = await openAccessRequest(
      jsonReq("/api/access/v1/access-request", {
        subject: { type: "agent", id: AID },
        action: { name: "purchase", properties: { amount_usd: 150, category: "software" } },
        resource: { type: "spend", id: "github" },
        denial: { binding_token: denial.access_request.binding_token },
      }),
    )
    expect(res.status).toBe(201)
    expect((await res.json()).task.status).toBe("pending")
    expect(createSpendPendingApproval).toHaveBeenCalled()
  })
})
