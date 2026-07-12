import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// CAP-1: capability governance. Pure-ladder semantics (prefix-glob patterns,
// block → allow-list → escalate precedence), the native route's full lifecycle
// (decision-only allow/deny, persisted escalation, grant redemption), and the
// AuthZEN wire's resource.type "capability".
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
    pendingApproval: { create: vi.fn() },
    grant: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/authzenRateLimit", () => ({ authzenRateLimit: vi.fn(async () => null) })) // limiter has its own tests
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${id}` : ""}` }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return { ...mod, walletAncestorChain: vi.fn(async () => []), reserveCascadeDailySpend: vi.fn(async () => []), cascadeDailyWouldExceed: vi.fn(async () => false) }
})

import { capabilityMatches, decideCapability, parseCapabilityRules } from "../lib/capability"
import { POST as capability } from "../app/api/v1/authorize/capability/route"
import { POST as evaluation } from "../app/api/access/v1/evaluation/route"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const AID = "agent_1"

const RULES = [
  { pattern: "skill:install:crypto-*", effect: "block" },
  { pattern: "skill:install:*", effect: "escalate" },
  { pattern: "api:github.com/*", effect: "allow" },
]

const POLICY = {
  id: "pol_1",
  walletId: WID,
  currentRevision: 2,
  capabilityRules: RULES,
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
  blockedTools: [], allowedTools: [], escalateTools: [],
  blockedCategories: [], allowedCategories: [],
  blockedResources: [], allowedResources: [], escalateResources: [],
  dailyTokenBudgetUsd: 1000, dailySpendBudgetUsd: 1_000_000, monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null, perTransactionMaxUsd: 10_000, autoApproveUnderUsd: 1_000, escalateOverUsd: 5_000,
}

const AGENT = {
  id: AID, walletId: WID, name: "tenet", isActive: true, lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null, dailySpendBudgetUsd: null, perTransactionMaxUsd: null, escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: POLICY },
}

function capReq(body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": KEY }
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey
  return new NextRequest("https://test.local/api/v1/authorize/capability", { method: "POST", headers, body: JSON.stringify(body) })
}

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  dbMock.wallet.findUnique.mockResolvedValue({ id: "w_root", parentId: null, frozenAt: null, frozenReason: null }) // KILL-1: routes now read freeze state
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
  dbMock.authorizationRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_1", createdAt: new Date(), decidedAt: null, decisionNote: null, ...data,
  }))
  dbMock.pendingApproval.create.mockResolvedValue({ id: "pa_1" })
  dbMock.grant.updateMany.mockResolvedValue({ count: 1 })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

describe("capability ladder (pure)", () => {
  it("prefix-glob matching: exact, star suffix, bare star", () => {
    expect(capabilityMatches("skill:install:*", "skill:install:scraper")).toBe(true)
    expect(capabilityMatches("skill:install:*", "plugin:x")).toBe(false)
    expect(capabilityMatches("api:github.com/repos", "api:github.com/repos")).toBe(true)
    expect(capabilityMatches("*", "anything:at:all")).toBe(true)
  })

  it("block overrides escalate; allow-list is opt-in; escalate wins over allow", () => {
    const rules = parseCapabilityRules(RULES)
    expect(decideCapability({ capability: "skill:install:crypto-miner", rules }).code).toBe("CAPABILITY_BLOCKED")
    expect(decideCapability({ capability: "skill:install:scraper", rules }).status).toBe("escalated")
    // Allow rules exist, so an unmatched capability is denied.
    expect(decideCapability({ capability: "plugin:unknown", rules }).code).toBe("CAPABILITY_NOT_ALLOWED")
    expect(decideCapability({ capability: "api:github.com/repos", rules }).status).toBe("allowed")
    // No rules at all = governance opt-in, allow.
    expect(decideCapability({ capability: "anything", rules: [] }).status).toBe("allowed")
  })

  it("parseCapabilityRules drops malformed entries", () => {
    expect(parseCapabilityRules([{ pattern: "x", effect: "block" }, { pattern: "", effect: "block" }, { effect: "allow" }, "junk", null])).toEqual([
      { pattern: "x", effect: "block" },
    ])
  })
})

describe("POST /v1/authorize/capability", () => {
  it("denies a blocked capability decision-only (no persistence)", async () => {
    const res = await capability(capReq({ capability: "skill:install:crypto-miner" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("CAPABILITY_BLOCKED")
    expect(body.remediation).toBeDefined()
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("persists an escalation to the inbox with evidence", async () => {
    const res = await capability(capReq({ capability: "skill:install:scraper" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("escalated")
    expect(body.request_id).toBe("req_1")
    expect(body.links.evidence).toBe("/api/v1/authorize/req_1/evidence")
    const created = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(created.kind).toBe("capability")
    expect(created.policyRevision).toBe(2)
    expect(created.decisionContextJson.ladder).toBe("capability")
    expect(dbMock.pendingApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actionType: "capability.use" }) }),
    )
  })

  it("replays a timed-out escalation with ESCALATION_TIMED_OUT, not a bare denial (F-1)", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_1", status: "denied", decisionNote: "Escalation timed out after 240m — auto-denied by policy",
    })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "idem-c1"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: false, status: "denied", code: "ESCALATION_TIMED_OUT" })
    expect(body.remediation).toContain("approval deadline")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("redeems a one-use grant and refuses a replay", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      id: "grant_1", walletId: WID, agentId: AID, actionType: "capability.use", status: "active",
      resourceJson: { kind: "capability", capability: "skill:install:scraper" },
      sourceType: "authorization_request", sourceId: "req_1", expiresAt: new Date(Date.now() + 600_000),
    })
    dbMock.authorizationRequest.update.mockImplementation(async () => ({ id: "req_1", status: "approved", decisionNote: "Grant consumed", amountUsd: 0, merchant: "skill:install:scraper", decidedAt: new Date() }))
    const ok = await capability(capReq({ capability: "skill:install:scraper", grant_id: "grant_1" }))
    expect((await ok.json()).grant_status).toBe("consumed")

    dbMock.grant.findUnique.mockResolvedValue({ id: "grant_1", walletId: WID, agentId: AID, actionType: "capability.use", status: "consumed", resourceJson: { kind: "capability", capability: "skill:install:scraper" }, sourceType: "authorization_request", sourceId: "req_1", expiresAt: null })
    const replay = await capability(capReq({ capability: "skill:install:scraper", grant_id: "grant_1" }))
    expect(replay.status).toBe(409)
    expect((await replay.json()).code).toBe("GRANT_ALREADY_USED")
  })

  it("allows ungoverned capabilities and 403s NO_POLICY without a policy", async () => {
    const allowed = await capability(capReq({ capability: "api:github.com/repos" }))
    expect((await allowed.json()).authorized).toBe(true)

    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const noPolicy = await capability(capReq({ capability: "x" }))
    expect(noPolicy.status).toBe(403)
    expect((await noPolicy.json()).code).toBe("NO_POLICY")
  })
})

describe("AuthZEN wire: resource.type capability", () => {
  function evalReq(capabilityId: string) {
    return new NextRequest("https://test.local/api/access/v1/evaluation", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify({ subject: { type: "agent", id: AID }, action: { name: "use" }, resource: { type: "capability", id: capabilityId } }),
    })
  }

  it("permits, denies, and escalates with the AARP offer", async () => {
    expect((await (await evaluation(evalReq("api:github.com/repos"))).json()).decision).toBe(true)

    const blocked = await (await evaluation(evalReq("skill:install:crypto-miner"))).json()
    expect(blocked.decision).toBe(false)
    expect(blocked.context.code).toBe("CAPABILITY_BLOCKED")
    expect(blocked.context.access_request).toBeUndefined()

    const escalated = await (await evaluation(evalReq("skill:install:scraper"))).json()
    expect(escalated.context.code).toBe("CAPABILITY_ESCALATION_REQUIRED")
    expect(escalated.context.access_request.binding_token).toBeDefined()
  })
})
