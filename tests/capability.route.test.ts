import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// CAP-1: capability governance. Pure-ladder semantics (prefix-glob patterns,
// block → allow-list → escalate precedence), the native route's full lifecycle
// (persisted allow/deny/escalation, grant redemption), and the
// AuthZEN wire's resource.type "capability".
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
    pendingApproval: { create: vi.fn(), findFirst: vi.fn() },
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
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${encodeURIComponent(id)}` : ""}` }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return { ...mod, walletAncestorChain: vi.fn(async (_tx: unknown, walletId: string) => [{ id: walletId, parentId: null, frozenAt: null, frozenReason: null, policy: null }]), reserveCascadeDailySpend: vi.fn(async () => []), cascadeDailyWouldExceed: vi.fn(async () => false) }
})

import { replayEvidence } from "../lib/evidence"
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

const STORED = {
  kind: "capability", action: "use", merchant: "skill:install:scraper",
  detailsJson: { capability: "skill:install:scraper" },
  createdAt: new Date("2026-10-03T12:00:00Z"), decidedAt: null,
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
  dbMock.pendingApproval.findFirst.mockResolvedValue(null)
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
  it("persists a blocked capability with replayable denial evidence", async () => {
    const res = await capability(capReq({ capability: "skill:install:crypto-miner" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("CAPABILITY_BLOCKED")
    expect(body.remediation).toBeDefined()
    expect(body.request_id).toBe("req_1")
    expect(body.decided_at).toBeDefined()
    const data = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(data).toMatchObject({ kind: "capability", status: "denied", policyRevision: 2 })
    expect(replayEvidence(data.decisionContextJson)).toMatchObject({ matches: true, effect: "deny", code: "CAPABILITY_BLOCKED" })
    expect(dbMock.pendingApproval.create).not.toHaveBeenCalled()
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
      ...STORED, id: "req_1", status: "denied", decisionNote: "Escalation timed out after 240m — auto-denied by policy",
    })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "idem-c1"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: false, status: "denied", code: "ESCALATION_TIMED_OUT" })
    expect(body.remediation).toContain("approval deadline")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("replays a human-approved escalation as status only — the one-use grant must be redeemed", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "pa_1" })
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...STORED, id: "req_prev", status: "approved", decisionNote: "Approved by owner" })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "idem-c2"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      authorized: false,
      status: "denied",
      approval_status: "approved",
      request_id: "req_prev",
      reason: "Approval status only; redeem the one-use grant to authorize an attempt",
    })
  })

  it("replays a legacy approved row (no PendingApproval) as allowed", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...STORED, id: "req_prev", status: "approved", decisionNote: "Approved by owner" })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "idem-c3"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authorized: true, status: "allowed", request_id: "req_prev" })
  })

  it("persists a policy allowance and replays its original identity without writing again", async () => {
    const request = { capability: "api:github.com/repos", arguments: { advisory: "not persisted" } }
    const first = await (await capability(capReq(request, "allow-key"))).json()
    const data = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: "approved", kind: "capability", detailsJson: { capability: request.capability }, idempotencyKey: "allow-key" })
    expect(data.detailsJson).not.toHaveProperty("arguments")
    expect(replayEvidence(data.decisionContextJson)).toMatchObject({ effect: "allow", matches: true })
    expect(first).toMatchObject({ authorized: true, status: "allowed", request_id: "req_1" })
    expect(first.created_at).toBeDefined()
    expect(first.decided_at).toBeDefined()
    const row = await dbMock.authorizationRequest.create.mock.results[0].value
    dbMock.authorizationRequest.findUnique.mockResolvedValue(row)
    // Advisory arguments deliberately do not change capability binding.
    const replay = await (await capability(capReq({ ...request, arguments: { advisory: "changed" } }, "allow-key"))).json()
    expect(replay).toEqual(first)
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledTimes(1)
  })

  it.each(["skill:install:crypto-miner", "plugin:unknown"])("retains the exact policy denial code on replay: %s", async (name) => {
    const first = await (await capability(capReq({ capability: name }, "deny-key"))).json()
    dbMock.authorizationRequest.findUnique.mockResolvedValue(await dbMock.authorizationRequest.create.mock.results[0].value)
    const replay = await (await capability(capReq({ capability: name }, "deny-key"))).json()
    expect(replay).toEqual(first)
    expect(first.code).toBe(name.startsWith("skill:") ? "CAPABILITY_BLOCKED" : "CAPABILITY_NOT_ALLOWED")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    { kind: "spend" },
    { merchant: "plugin:other", detailsJson: { capability: "plugin:other" } },
    { action: "purchase" },
    { detailsJson: null },
  ])("refuses a reused key with mismatched action binding: %j", async (mismatch) => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...STORED, id: "foreign", status: "approved", decisionNote: null, ...mismatch })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "collision"))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ authorized: false, code: "IDEMPOTENCY_CONFLICT" })
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
    expect(dbMock.pendingApproval.findFirst).not.toHaveBeenCalled()
  })

  it.each([false, true])("handles a concurrent key winner without issuing another decision (mismatch=%s)", async (mismatch) => {
    const row = { ...STORED, id: "winner", status: "approved", decisionNote: null,
      merchant: mismatch ? "different" : "api:github.com/repos",
      detailsJson: { capability: mismatch ? "different" : "api:github.com/repos" },
    }
    dbMock.authorizationRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    dbMock.authorizationRequest.create.mockRejectedValueOnce({ code: "P2002" })
    const res = await capability(capReq({ capability: "api:github.com/repos" }, "racing-key"))
    expect(res.status).toBe(mismatch ? 409 : 200)
    expect(await res.json()).toMatchObject(mismatch
      ? { authorized: false, code: "IDEMPOTENCY_CONFLICT" }
      : { authorized: true, request_id: "winner" })
    expect(dbMock.pendingApproval.create).not.toHaveBeenCalled()
  })

  it("refuses a cross-kind winner of an escalation insert race", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...STORED, id: "foreign", kind: "spend", status: "approved", decisionNote: null,
    })
    dbMock.authorizationRequest.create.mockRejectedValueOnce({ code: "P2002" })
    const res = await capability(capReq({ capability: "skill:install:scraper" }, "racing-escalation"))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ authorized: false, code: "IDEMPOTENCY_CONFLICT" })
    expect(dbMock.pendingApproval.create).not.toHaveBeenCalled()
  })

  it("does not return allowance when its audit write fails", async () => {
    dbMock.authorizationRequest.create.mockRejectedValueOnce(new Error("storage unavailable"))
    await expect(capability(capReq({ capability: "api:github.com/repos" }))).rejects.toThrow("storage unavailable")
  })

  it("persists no-policy refusal without fabricating replayable policy evidence", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const first = await (await capability(capReq({ capability: "plugin:test" }, "no-policy-key"))).json()
    const data = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(first).toMatchObject({ authorized: false, code: "NO_POLICY", request_id: "req_1" })
    expect(data).toMatchObject({ status: "denied", kind: "capability", decisionNote: "No policy configured" })
    expect(data.decisionContextJson).toBeUndefined()
    expect(data.policyRevision).toBeUndefined()
    dbMock.authorizationRequest.findUnique.mockResolvedValue(await dbMock.authorizationRequest.create.mock.results[0].value)
    expect(await (await capability(capReq({ capability: "plugin:test" }, "no-policy-key"))).json()).toEqual(first)
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
