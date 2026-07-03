import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests (mocked Prisma) for the remaining untested data-plane and
// management surfaces: tool authorization, token logging + daily token budget,
// authorization status polling, and the owner-only policy/stats endpoints.
// The shared theme: every surface fails closed — no key, wrong key, or a key
// from another wallet gets a 401/403, never data.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    wallet: { findUnique: vi.fn() },
    policy: { findUnique: vi.fn() },
    tokenLog: { create: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    grant: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    pendingApproval: { count: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn(async () => {}) }))
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve" }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return { ...mod, reserveCascadeDailySpend: vi.fn(async () => []) }
})
// Timeout-settling logic is covered by approvals.test.ts; pass rows through here.
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return { ...mod, settleIfExpired: vi.fn(async (r: unknown) => r) }
})
// Policy validation/update math is covered by policy.test.ts.
vi.mock("@/lib/policy", async (orig) => {
  const mod = await orig<typeof import("@/lib/policy")>()
  return { ...mod, applyPolicyUpdate: vi.fn() }
})

import { POST as authorizeTool } from "../app/api/v1/authorize/tool/route"
import { POST as logTokens } from "../app/api/v1/tokens/route"
import { GET as authStatus } from "../app/api/v1/authorize/[id]/route"
import { GET as getPolicy, PATCH as patchPolicy } from "../app/api/v1/wallets/policy/route"
import { GET as getStats } from "../app/api/v1/wallets/stats/route"
import { applyPolicyUpdate } from "../lib/policy"

const KEY = "pxy_testagentkey"
const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AID = "agent_1"

const POLICY = {
  id: "pol_1",
  walletId: WID,
  dailyTokenBudgetUsd: 1_000, // $10/day token budget
  dailySpendBudgetUsd: 5_000,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: [],
  allowedTools: [],
  blockedTools: ["shell.exec"],
  escalateTools: ["payments.charge"],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
  updatedAt: new Date(),
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

const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}
const agentH = { "x-api-key": KEY }
const mgmtH = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

// ── /v1/authorize/tool (ADR-0009 M3) ────────────────────────────────────────

describe("authorize/tool — tool governance", () => {
  it("401 without an API key", async () => {
    expect((await authorizeTool(req("POST", "/api/v1/authorize/tool", { body: { tool: "x" } }))).status).toBe(401)
  })

  it("400 on an empty tool name", async () => {
    expect((await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "" } }))).status).toBe(400)
  })

  it("fails closed with NO_POLICY when the wallet has no policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const res = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "web.search" } }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("NO_POLICY")
  })

  it("allows an unlisted tool when the allow-list is empty (governance is opt-in)", async () => {
    const res = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "web.search" } }))
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ authorized: true, status: "allowed", tool: "web.search" })
  })

  it("denies a blocked tool", async () => {
    const res = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "shell.exec" } }))
    expect(res.status).toBe(403)
    expect((await res.json())).toMatchObject({ authorized: false, status: "denied" })
  })

  it("escalates an escalate-listed tool: 200, persisted, and lands in the approval inbox", async () => {
    dbMock.authorizationRequest.create.mockResolvedValue({ id: "req_t1", createdAt: new Date() })
    dbMock.pendingApproval.create.mockResolvedValue({ id: "pa_t1" })
    const res = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "payments.charge", server: "stripe" } }))
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ authorized: false, status: "escalated", request_id: "req_t1" })
    // The audit row: kind tool, $0, tool name in the shared display column.
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "tool", action: "invoke", amountUsd: 0, merchant: "payments.charge", status: "escalated" }),
      }),
    )
    // The inbox item, one-use grant contract attached.
    expect(dbMock.pendingApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: "tool.invoke",
          resourceJson: { kind: "tool", tool: "payments.charge", server: "stripe" },
          sourceId: "req_t1",
        }),
      }),
    )
  })

  it("replays a persisted escalation for a repeated Idempotency-Key without re-deciding", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_t1", status: "escalated", decisionNote: "Tool requires approval" })
    const res = await authorizeTool(
      req("POST", "/api/v1/authorize/tool", { headers: { ...agentH, "idempotency-key": "idem-t1" }, body: { tool: "payments.charge" } }),
    )
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ status: "escalated", request_id: "req_t1", code: "TOOL_ESCALATION_REQUIRED" })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("redeems an approved tool grant: one-use consumption authorizes the invocation", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      id: "grant_t1", walletId: WID, agentId: AID, actionType: "tool.invoke", status: "active",
      resourceJson: { kind: "tool", tool: "payments.charge", server: "stripe" },
      sourceType: "authorization_request", sourceId: "req_t1", expiresAt: null,
    })
    dbMock.grant.updateMany.mockResolvedValue({ count: 1 })
    dbMock.authorizationRequest.update.mockResolvedValue({ id: "req_t1", status: "approved" })
    const res = await authorizeTool(
      req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "payments.charge", server: "stripe", grant_id: "grant_t1" } }),
    )
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ authorized: true, status: "allowed", grant_id: "grant_t1", grant_status: "consumed" })
  })

  it("refuses a grant minted for a different tool (GRANT_MISMATCH)", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      id: "grant_t1", walletId: WID, agentId: AID, actionType: "tool.invoke", status: "active",
      resourceJson: { kind: "tool", tool: "payments.charge", server: "stripe" },
      sourceType: "authorization_request", sourceId: "req_t1", expiresAt: null,
    })
    const res = await authorizeTool(
      req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "shell.exec", grant_id: "grant_t1" } }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("GRANT_MISMATCH")
  })

  it("refuses an already-consumed tool grant (409)", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      id: "grant_t1", walletId: WID, agentId: AID, actionType: "tool.invoke", status: "consumed",
      resourceJson: { kind: "tool", tool: "payments.charge", server: null },
      sourceType: "authorization_request", sourceId: "req_t1", expiresAt: null,
    })
    const res = await authorizeTool(
      req("POST", "/api/v1/authorize/tool", { headers: agentH, body: { tool: "payments.charge", grant_id: "grant_t1" } }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("GRANT_ALREADY_USED")
  })
})

// ── /v1/tokens — LLM usage logging + daily token budget ─────────────────────

describe("tokens — usage logging under the daily token budget", () => {
  const USAGE = { model: "claude-sonnet-5", tokens_in: 1000, tokens_out: 500, cost_usd: 0.05 }

  it("401 without an API key", async () => {
    expect((await logTokens(req("POST", "/api/v1/tokens", { body: USAGE }))).status).toBe(401)
  })

  it("400 on negative token counts", async () => {
    expect((await logTokens(req("POST", "/api/v1/tokens", { headers: agentH, body: { ...USAGE, tokens_in: -1 } }))).status).toBe(400)
  })

  it("logs directly when the wallet has no policy (nothing to enforce)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    dbMock.tokenLog.create.mockResolvedValue({ id: "tl_1" })
    const res = await logTokens(req("POST", "/api/v1/tokens", { headers: agentH, body: USAGE }))
    expect(res.status).toBe(200)
    expect((await res.json()).recorded).toBe(true)
  })

  it("records usage under budget, serialized inside the per-agent lock", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 1 } }) // $1 of a $10 budget
    dbMock.tokenLog.create.mockResolvedValue({ id: "tl_2" })
    const res = await logTokens(req("POST", "/api/v1/tokens", { headers: agentH, body: USAGE }))
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ id: "tl_2", recorded: true })
    expect(dbMock.$executeRaw).toHaveBeenCalled() // advisory lock taken
  })

  it("402s when the call would overshoot the daily token budget, and writes nothing", async () => {
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 9.99 } })
    const res = await logTokens(req("POST", "/api/v1/tokens", { headers: agentH, body: USAGE })) // 9.99 + 0.05 > 10
    expect(res.status).toBe(402)
    expect((await res.json()).daily_limit_usd).toBe(10)
    expect(dbMock.tokenLog.create).not.toHaveBeenCalled()
  })

  it("lets a per-agent budget override win over the wallet policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, dailyTokenBudgetUsd: 1 }) // $0.01/day
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } })
    const res = await logTokens(req("POST", "/api/v1/tokens", { headers: agentH, body: USAGE }))
    expect(res.status).toBe(402)
  })
})

// ── /v1/authorize/[id] — status polling ─────────────────────────────────────

describe("authorize/[id] — status polling stays inside the wallet", () => {
  const ROW = {
    id: "req_1",
    status: "approved",
    decisionNote: "Auto-approved",
    decidedAt: new Date(),
    amountUsd: 5,
    merchant: "Anthropic",
    agent: { name: "tenet", walletId: WID, wallet: { policy: POLICY } },
  }
  const params = { params: Promise.resolve({ id: "req_1" }) }

  it("404 for an unknown request id", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
    expect((await authStatus(req("GET", "/api/v1/authorize/req_1"), params)).status).toBe(404)
  })

  it("401 with no credentials at all", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(ROW)
    dbMock.agent.findUnique.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await authStatus(req("GET", "/api/v1/authorize/req_1"), params)).status).toBe(401)
  })

  it("401 for an agent key from a different wallet", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(ROW)
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, walletId: "wallet_other" })
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await authStatus(req("GET", "/api/v1/authorize/req_1", { headers: agentH }), params)).status).toBe(401)
  })

  it("returns the decision (and grant receipt) to the requesting agent", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(ROW)
    dbMock.grant.findFirst.mockResolvedValue({ id: "grant_1", status: "active", expiresAt: null, consumedAt: null })
    const res = await authStatus(req("GET", "/api/v1/authorize/req_1", { headers: agentH }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "approved", request_id: "req_1", grant_id: "grant_1", grant_status: "active" })
  })

  it("lets the wallet owner (management key) read it too", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...ROW, status: "escalated", decidedAt: null })
    dbMock.agent.findUnique.mockResolvedValue(null) // no agent key presented
    const res = await authStatus(req("GET", "/api/v1/authorize/req_1", { headers: mgmtH }), params)
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ authorized: false, status: "escalated" })
  })
})

// ── /v1/wallets/policy — owner-only policy read/update ──────────────────────

describe("wallets/policy — owner-only, fail closed", () => {
  it("400 without wallet_id", async () => {
    expect((await getPolicy(req("GET", "/api/v1/wallets/policy"))).status).toBe(400)
  })

  it("401 with a wrong management key", async () => {
    const res = await getPolicy(req("GET", `/api/v1/wallets/policy?wallet_id=${WID}`, { headers: { "x-mgmt-key": "sk_wrong" } }))
    expect(res.status).toBe(401)
    expect(dbMock.policy.findUnique).not.toHaveBeenCalled() // nothing leaks before auth
  })

  it("returns the policy in dollars to the owner", async () => {
    dbMock.policy.findUnique.mockResolvedValue(POLICY)
    const res = await getPolicy(req("GET", `/api/v1/wallets/policy?wallet_id=${WID}`, { headers: mgmtH }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.policy.per_transaction_max_usd).toBe(100) // 10_000 cents → dollars
    expect(body.policy.daily_token_budget_usd).toBe(10)
  })

  it("404 when no policy is configured", async () => {
    dbMock.policy.findUnique.mockResolvedValue(null)
    expect((await getPolicy(req("GET", `/api/v1/wallets/policy?wallet_id=${WID}`, { headers: mgmtH }))).status).toBe(404)
  })

  it("PATCH requires the management key before touching anything", async () => {
    const res = await patchPolicy(req("PATCH", "/api/v1/wallets/policy", { headers: { "x-mgmt-key": "sk_wrong" }, body: { wallet_id: WID, per_transaction_max_usd: 1 } }))
    expect(res.status).toBe(401)
    expect(applyPolicyUpdate).not.toHaveBeenCalled()
  })

  it("PATCH applies a partial update for the owner", async () => {
    vi.mocked(applyPolicyUpdate).mockResolvedValue({ ok: true, policy: { per_transaction_max_usd: 42 } } as never)
    const res = await patchPolicy(req("PATCH", "/api/v1/wallets/policy", { headers: mgmtH, body: { wallet_id: WID, per_transaction_max_usd: 42 } }))
    expect(res.status).toBe(200)
    expect(vi.mocked(applyPolicyUpdate).mock.calls[0][0]).toBe(WID)
  })

  it("PATCH surfaces validation failures as 400", async () => {
    vi.mocked(applyPolicyUpdate).mockResolvedValue({ ok: false, error: "escalate_over_usd must be below per_transaction_max_usd" } as never)
    const res = await patchPolicy(req("PATCH", "/api/v1/wallets/policy", { headers: mgmtH, body: { wallet_id: WID, escalate_over_usd: 1e9 } }))
    expect(res.status).toBe(400)
  })
})

// ── /v1/wallets/stats — membership-gated dashboard read ─────────────────────

describe("wallets/stats — membership required (owner or in-wallet agent)", () => {
  beforeEach(() => {
    dbMock.agent.findMany.mockResolvedValue([{ id: AID }])
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 1.5, tokensIn: 100, tokensOut: 50 } })
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 20 } })
    dbMock.authorizationRequest.findMany.mockResolvedValue([])
    dbMock.tokenLog.findMany.mockResolvedValue([])
    dbMock.pendingApproval.count.mockResolvedValue(2)
  })

  it("400 without wallet_id", async () => {
    expect((await getStats(req("GET", "/api/v1/wallets/stats"))).status).toBe(400)
  })

  it("401 with no credentials — knowing the wallet_id alone reads nothing", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue(null)
    expect((await getStats(req("GET", `/api/v1/wallets/stats?wallet_id=${WID}`))).status).toBe(401)
  })

  it("401 for an agent key belonging to a different wallet", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, walletId: "wallet_other" })
    expect((await getStats(req("GET", `/api/v1/wallets/stats?wallet_id=${WID}`, { headers: agentH }))).status).toBe(401)
  })

  it("serves the owner via the management key", async () => {
    const res = await getStats(req("GET", `/api/v1/wallets/stats?wallet_id=${WID}`, { headers: mgmtH }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today).toMatchObject({ token_cost_usd: 1.5, spend_usd: 20 })
    expect(body.pending_approvals).toBe(2)
  })

  it("serves an in-wallet agent via its API key", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null) // no mgmt key presented
    const res = await getStats(req("GET", `/api/v1/wallets/stats?wallet_id=${WID}`, { headers: agentH }))
    expect(res.status).toBe(200)
  })
})
