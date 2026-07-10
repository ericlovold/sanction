import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Hardening sprint 2 — the five CONFIRMED code-review findings, pinned:
// (1) a malformed batch sibling 400s BEFORE any grant-consuming write,
// (2) binding tokens are single-use (jti consumed with the escalation),
// (3) a timeout-approve mints a redeemable grant (no AARP dead loop),
// (4) the AuthZEN endpoints rate-limit per agent with Retry-After,
// (5) an explicit empty batch returns empty, not a default-tuple eval.

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn() },
    pendingApproval: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    grant: { create: vi.fn(), findFirst: vi.fn() },
    consumedBindingToken: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(async () => ({ count: 0 })) },
    rateLimit: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return { ...mod, walletAncestorChain: vi.fn(async () => []), cascadeDailyWouldExceed: vi.fn(async () => false) }
})

import { POST as evaluation } from "../app/api/access/v1/evaluation/route"
import { POST as evaluations } from "../app/api/access/v1/evaluations/route"
import { POST as accessRequest } from "../app/api/access/v1/access-request/route"
import { accessRequestOffer, verifyBindingToken, type AuthZenAgent } from "../lib/authzen"
import { settleIfExpired } from "../lib/approvals"

const KEY = "pxy_hardeningkey"
const WID = "wallet_h"
const AID = "agent_h"

const POLICY = {
  id: "pol_h",
  walletId: WID,
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
  escalateTools: ["github.merge_pr"],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
  outcomeKind: null,
  costPerOutcomeCeilingUsd: null,
  costPerOutcomeWindowDays: 7,
  costPerOutcomeMinOutcomes: 5,
}

const AGENT = {
  id: AID,
  walletId: WID,
  name: "hardened",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: POLICY },
}

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://test.local/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, ...headers },
    body: JSON.stringify(body),
  })
}

const subject = { type: "agent", id: AID }
const spendItem = (amountUsd: number) => ({
  subject,
  action: { name: "purchase", properties: { amount_usd: amountUsd } },
  resource: { type: "spend", id: "github" },
})

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 0 } })
  // Fresh rate-limit window on every call unless a test overrides it.
  dbMock.rateLimit.findUnique.mockResolvedValue(null)
  dbMock.rateLimit.upsert.mockResolvedValue({})
  dbMock.consumedBindingToken.create.mockResolvedValue({})
  dbMock.consumedBindingToken.findUnique.mockResolvedValue(null)
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

// ── (1) Batch grant-atomicity ────────────────────────────────────────────────

describe("batch pre-validation protects grant redemption", () => {
  it("400s on a semantically malformed sibling BEFORE any evaluation or write", async () => {
    const res = await evaluations(
      req("/access/v1/evaluations", {
        evaluations: [
          { ...spendItem(20), context: { approval: { id: "grant_1" } } }, // would redeem (a write)
          { subject, action: { name: "purchase" }, resource: { type: "spend", id: "github" } }, // missing amount_usd
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("index 1")
    // The redemption sibling never ran: no transaction, no grant write.
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    // And no evaluation ran either — the budget reads never happened.
    expect(dbMock.authorizationRequest.aggregate).not.toHaveBeenCalled()
  })

  it("400s a non-string approval id up front for the same reason", async () => {
    const res = await evaluations(
      req("/access/v1/evaluations", {
        evaluations: [{ ...spendItem(20), context: { approval: { id: 42 } } }, spendItem(5)],
      }),
    )
    expect(res.status).toBe(400)
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })
})

// ── (5) Empty batch ──────────────────────────────────────────────────────────

describe("empty batch", () => {
  it("evaluations: [] returns an empty result, not a default-tuple evaluation", async () => {
    const res = await evaluations(req("/access/v1/evaluations", { ...spendItem(5), evaluations: [] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ evaluations: [] })
    expect(dbMock.authorizationRequest.aggregate).not.toHaveBeenCalled()
  })

  it("an ABSENT evaluations array still evaluates the defaults as one item (per spec)", async () => {
    const res = await evaluations(req("/access/v1/evaluations", spendItem(5)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.evaluations).toHaveLength(1)
    expect(body.evaluations[0].decision).toBe(true)
  })
})

// ── (4) Rate limiting ────────────────────────────────────────────────────────

describe("per-agent rate limits", () => {
  it("429s with Retry-After when the window is exhausted", async () => {
    const windowEnd = new Date(Date.now() + 30_000)
    dbMock.rateLimit.findUnique.mockResolvedValue({ key: `authzen-eval:${AID}`, count: 240, windowEnd })
    dbMock.rateLimit.update.mockResolvedValue({ count: 241 })
    const res = await evaluation(req("/access/v1/evaluation", spendItem(5)))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
  })

  it("keys the limit to the agent, not the IP", async () => {
    await evaluation(req("/access/v1/evaluation", spendItem(5)))
    expect(dbMock.rateLimit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: `authzen-eval:${AID}` } }),
    )
  })
})

// ── (2) Binding-token single-use ─────────────────────────────────────────────

const asAgent = AGENT as unknown as AuthZenAgent

async function mintToken() {
  const offer = await accessRequestOffer(
    asAgent,
    { subject, action: { name: "invoke" }, resource: { type: "tool", id: "github.merge_pr" } },
    "needs approval",
  )
  return offer.binding_token
}

function submission(token: string) {
  return {
    subject,
    action: { name: "invoke" },
    resource: { type: "tool", id: "github.merge_pr" },
    denial: { binding_token: token },
  }
}

describe("binding-token single-use (jti)", () => {
  it("mints a jti into every offer and verification extracts it", async () => {
    const token = await mintToken()
    const v = await verifyBindingToken(asAgent, token)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.jti).toMatch(/[0-9a-f-]{36}/)
      expect(v.expiresAt.getTime()).toBeGreaterThan(Date.now())
    }
  })

  it("consumes the jti atomically with the escalation create", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(null) // no idempotent replay
    dbMock.authorizationRequest.create.mockResolvedValue({ id: "req_1", createdAt: new Date() })
    dbMock.pendingApproval.create.mockResolvedValue({ id: "appr_1" })
    const token = await mintToken()
    const res = await accessRequest(req("/access/v1/access-request", submission(token), { "idempotency-key": "k1" }))
    expect(res.status).toBe(201)
    expect(dbMock.consumedBindingToken.create).toHaveBeenCalledOnce()
  })

  it("rejects a replayed token under a DIFFERENT idempotency key (one denial, one escalation)", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
    const p2002 = Object.assign(new Error("unique"), { code: "P2002" })
    dbMock.consumedBindingToken.create.mockRejectedValue(p2002)
    dbMock.consumedBindingToken.findUnique.mockResolvedValue({ jti: "used" })
    const token = await mintToken()
    const res = await accessRequest(req("/access/v1/access-request", submission(token), { "idempotency-key": "k2" }))
    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("problem+json")
    const body = await res.json()
    expect(body.title).toContain("already been used")
  })

  it("a retry under the SAME idempotency key replays the existing task (retries stay safe)", async () => {
    // First check: replay row exists → returned before the jti is ever touched.
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_1", status: "escalated", decisionNote: null })
    const token = await mintToken()
    const res = await accessRequest(req("/access/v1/access-request", submission(token), { "idempotency-key": "k1" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.id).toBe("req_1")
    expect(dbMock.consumedBindingToken.create).not.toHaveBeenCalled()
  })

  it("fails closed on a token minted without a jti (legacy)", async () => {
    const { SignJWT } = await import("jose")
    const legacy = await new SignJWT({ purpose: "authzen-access-request", sarc: { t: "tool", tool: "github.merge_pr", server: null } })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("sanction")
      .setAudience([WID])
      .setSubject(AID)
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + 60_000))
      .sign(new TextEncoder().encode(process.env.SANCTION_SIGNING_SECRET))
    const v = await verifyBindingToken(asAgent, legacy)
    expect(v.ok).toBe(false)
  })
})

// ── (3) Timeout-approve mints a grant ────────────────────────────────────────

describe("timeout-approve mints a redeemable grant", () => {
  const past = new Date(Date.now() - 60 * 60_000) // escalated an hour ago
  const row = { id: "req_t", status: "escalated", decisionNote: null, decidedAt: null, createdAt: past }
  const approval = {
    id: "appr_t",
    walletId: WID,
    agentId: AID,
    actionType: "spend.purchase",
    status: "pending",
    subjectJson: { agent: AID },
    resourceJson: { amount_usd: 60 },
    constraintsJson: null,
    sourceType: "authorization_request",
    sourceId: "req_t",
  }

  beforeEach(() => {
    dbMock.authorizationRequest.updateMany.mockResolvedValue({ count: 1 })
    dbMock.pendingApproval.updateMany.mockResolvedValue({ count: 1 })
    dbMock.pendingApproval.findFirst.mockResolvedValue(approval)
    dbMock.grant.create.mockResolvedValue({ id: "grant_t" })
  })

  it("settleIfExpired on a timeout-APPROVE policy creates the grant a human approval would", async () => {
    const d = await settleIfExpired(row, { escalationTimeoutMins: 30, escalationTimeoutAction: "approve" })
    expect(d.status).toBe("approved")
    expect(dbMock.grant.create).toHaveBeenCalledOnce()
    const data = dbMock.grant.create.mock.calls[0]![0].data
    expect(data.issuedBy).toBe("policy_timeout")
    expect(data.issuedFromApprovalId).toBe("appr_t")
    expect(data.sourceId).toBe("req_t")
  })

  it("timeout-DENY mints nothing", async () => {
    const d = await settleIfExpired(row, { escalationTimeoutMins: 30, escalationTimeoutAction: "deny" })
    expect(d.status).toBe("denied")
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })

  it("no grant is minted when there is no pending approval to mint from (legacy escalation)", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(null)
    const d = await settleIfExpired(row, { escalationTimeoutMins: 30, escalationTimeoutAction: "approve" })
    expect(d.status).toBe("approved")
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })
})
