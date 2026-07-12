import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { SignJWT } from "jose"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests for the AuthZEN Access Request and Approval Profile
// (AARP, draft 1) — the escalate→approve→grant loop on the standards wire.
// Covers: the requestable-denial offer on escalate outcomes, denial binding
// (tampered / mismatched / expired tokens fail closed), opening the real
// escalation, task status mapping incl. the grant-as-approval artifact,
// atomic redemption via context.approval, and discovery metadata.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    pendingApproval: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    grant: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    executionToken: { findUnique: vi.fn() },
    consumedBindingToken: { create: vi.fn(async () => ({})), findUnique: vi.fn(async () => null), deleteMany: vi.fn(async () => ({ count: 0 })) },
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
  return {
    ...mod,
    walletAncestorChain: vi.fn(async () => []),
    reserveCascadeDailySpend: vi.fn(async () => []),
    cascadeDailyWouldExceed: vi.fn(async () => false),
  }
})

import { verifyBindingToken, type AuthZenAgent } from "../lib/authzen"
import { POST as evaluation } from "../app/api/access/v1/evaluation/route"
import { POST as openAccessRequest } from "../app/api/access/v1/access-request/route"
import { GET as taskStatus } from "../app/api/access/v1/access-request/[id]/route"
import { GET as wellKnown } from "../app/.well-known/authzen-configuration/route"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const AID = "agent_1"

const POLICY = {
  id: "pol_1",
  walletId: WID,
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
  escalateTools: ["github.merge_pr"],
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

const subject = { type: "agent", id: AID }
const escalatedTool = { subject, action: { name: "invoke" }, resource: { type: "tool", id: "github.merge_pr" } }

function req(path: string, body: unknown, opts: { key?: string | null; method?: string; idem?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  // access-request submissions require an Idempotency-Key (replay guard). Default
  // one on for the open-escalation tests; pass idem:null to assert its absence.
  if (path.endsWith("/access-request") && opts.idem !== null) headers["idempotency-key"] = opts.idem ?? "idem-default"
  return new NextRequest(`https://test.local${path}`, {
    method: opts.method ?? "POST",
    headers,
    ...(opts.method === "GET" ? {} : { body: JSON.stringify(body) }),
  })
}

function getReq(path: string, opts: { key?: string | null } = {}) {
  const headers: Record<string, string> = {}
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  return new NextRequest(`https://test.local${path}`, { method: "GET", headers })
}

/** Run a real escalated evaluation and return its access_request offer. */
async function obtainOffer() {
  const res = await evaluation(req("/api/access/v1/evaluation", escalatedTool))
  const body = await res.json()
  expect(body.context.access_request).toBeDefined()
  return body.context.access_request as { endpoint: string; expires_at: string; binding_token: string }
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
  dbMock.authorizationRequest.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_1",
    amountUsd: 0,
    merchant: "github.merge_pr",
    decidedAt: new Date(),
    ...data,
  }))
  dbMock.pendingApproval.create.mockResolvedValue({ id: "pa_1" })
  dbMock.pendingApproval.findFirst.mockResolvedValue(null)
  dbMock.grant.updateMany.mockResolvedValue({ count: 1 })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

describe("requestable denials", () => {
  it("attaches an access_request offer to escalate outcomes", async () => {
    const offer = await obtainOffer()
    expect(offer.endpoint).toBe("https://test.local/api/access/v1/access-request")
    expect(offer.binding_token.split(".")).toHaveLength(3)
    expect(new Date(offer.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it("does not attach an offer to plain denials", async () => {
    const blocked = { ...escalatedTool, resource: { type: "tool", id: "shell.exec" } }
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, blockedTools: ["shell.exec"] } },
    })
    const res = await evaluation(req("/api/access/v1/evaluation", blocked))
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.access_request).toBeUndefined()
  })
})

describe("POST /access/v1/access-request", () => {
  it("opens a real escalation from a valid binding token", async () => {
    const offer = await obtainOffer()
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...escalatedTool, denial: { binding_token: offer.binding_token } }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.task.status).toBe("pending")
    expect(body.task.status_endpoint).toContain("/api/access/v1/access-request/req_1")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "escalated", kind: "tool" }) }),
    )
    expect(dbMock.pendingApproval.create).toHaveBeenCalled()
  })

  it("requires an Idempotency-Key (replay guard on the not-yet-single-use token)", async () => {
    const offer = await obtainOffer()
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...escalatedTool, denial: { binding_token: offer.binding_token } }, { idem: null }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Idempotency-Key")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a tampered token with the profile's problem type", async () => {
    const offer = await obtainOffer()
    const tampered = offer.binding_token.slice(0, -4) + "AAAA"
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...escalatedTool, denial: { binding_token: tampered } }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).type).toContain("invalid_denial_binding")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a token whose SARC does not match the submission", async () => {
    const offer = await obtainOffer()
    const other = { ...escalatedTool, resource: { type: "tool", id: "some.other.tool" } }
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...other, denial: { binding_token: offer.binding_token } }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).type).toContain("invalid_denial_binding")
  })

  it("binds the token to its agent — a same-wallet peer cannot redeem it (Fearless P8)", async () => {
    // A binding token is minted for AID and scoped to the wallet audience. A
    // different agent in the SAME wallet passes the audience check but must
    // fail the subject binding — otherwise agent A's approval is replayable by
    // agent B. verifyBindingToken is the enforcement point; this pins it
    // directly (the route/PDP subject checks would otherwise mask a regression).
    const offer = await obtainOffer() // token.sub = AID
    const base = { name: "x", perTransactionMaxUsd: null, dailySpendBudgetUsd: null, escalateOverUsd: null, wallet: { policy: null } }
    const self: AuthZenAgent = { ...base, id: AID, walletId: WID }
    const peer: AuthZenAgent = { ...base, id: "agent_2", walletId: WID }

    // Positive control: the rightful agent verifies clean, proving the token is
    // otherwise valid — so the peer's rejection is specifically the sub binding.
    expect((await verifyBindingToken(self, offer.binding_token)).ok).toBe(true)
    expect((await verifyBindingToken(peer, offer.binding_token)).ok).toBe(false)
  })

  it("rejects an expired denial with 410", async () => {
    const secret = new TextEncoder().encode(process.env.SANCTION_SIGNING_SECRET)
    const expired = await new SignJWT({
      purpose: "authzen-access-request",
      sarc: { t: "tool", tool: "github.merge_pr", server: null },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("sanction")
      .setAudience([WID])
      .setSubject(AID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret)
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...escalatedTool, denial: { binding_token: expired } }),
    )
    expect(res.status).toBe(410)
    expect((await res.json()).type).toContain("expired_denial")
  })

  it("opens a spend escalation with the dollar shape intact", async () => {
    const spend = {
      subject,
      action: { name: "purchase", properties: { amount_usd: 60, category: "software" } },
      resource: { type: "spend", id: "github" },
    }
    const evalRes = await evaluation(req("/api/access/v1/evaluation", spend))
    const offer = (await evalRes.json()).context.access_request
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...spend, denial: { binding_token: offer.binding_token } }),
    )
    expect(res.status).toBe(201)
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "escalated", action: "purchase", amountUsd: 60, merchant: "github" }),
      }),
    )
  })

  it("opens a provision escalation carrying line item and quantity", async () => {
    const provision = {
      subject,
      action: { name: "allocate", properties: { amount_usd: 60, quantity: 2, unit_price_usd: 30, line_item: "M365 E3", category: "software" } },
      resource: { type: "provision", id: "azure:seat" },
    }
    const evalRes = await evaluation(req("/api/access/v1/evaluation", provision))
    const offer = (await evalRes.json()).context.access_request
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", { ...provision, denial: { binding_token: offer.binding_token } }),
    )
    expect(res.status).toBe(201)
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "provision",
          detailsJson: expect.objectContaining({ line_item: "M365 E3", quantity: 2, unit_price_usd: 30 }),
        }),
      }),
    )
  })

  it("replays idempotently instead of opening a duplicate", async () => {
    const offer = await obtainOffer()
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_existing", status: "escalated", decisionNote: null })
    const request = new NextRequest("https://test.local/api/access/v1/access-request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "idempotency-key": "idem-1" },
      body: JSON.stringify({ ...escalatedTool, denial: { binding_token: offer.binding_token } }),
    })
    const res = await openAccessRequest(request)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.id).toBe("req_existing")
    expect(body.task.status).toBe("pending")
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("replay reports the real status once the owner has decided", async () => {
    const offer = await obtainOffer()
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_existing",
      status: "approved",
      decisionNote: "Approved by owner",
    })
    const request = new NextRequest("https://test.local/api/access/v1/access-request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "idempotency-key": "idem-1" },
      body: JSON.stringify({ ...escalatedTool, denial: { binding_token: offer.binding_token } }),
    })
    const res = await openAccessRequest(request)
    expect((await res.json()).task.status).toBe("approved")
  })

  it("400s without a policy or without a denial object", async () => {
    const offer = await obtainOffer()
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const noPolicy = await openAccessRequest(
      req("/api/access/v1/access-request", { ...escalatedTool, denial: { binding_token: offer.binding_token } }),
    )
    expect(noPolicy.status).toBe(400)

    dbMock.agent.findUnique.mockResolvedValue(AGENT)
    const noDenial = await openAccessRequest(req("/api/access/v1/access-request", escalatedTool))
    expect(noDenial.status).toBe(400)
  })

  it("refuses a subject other than the authenticated agent", async () => {
    const offer = await obtainOffer()
    const res = await openAccessRequest(
      req("/api/access/v1/access-request", {
        ...escalatedTool,
        subject: { type: "agent", id: "someone_else" },
        denial: { binding_token: offer.binding_token },
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe("GET /access/v1/access-request/{id}", () => {
  const baseRow = {
    id: "req_1",
    status: "escalated",
    decisionNote: null,
    decidedAt: null,
    createdAt: new Date(),
    amountUsd: 0,
    merchant: "github.merge_pr",
    agent: { walletId: WID, wallet: { policy: POLICY } },
  }

  it("reports pending while the escalation waits", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(baseRow)
    const res = await taskStatus(getReq("/api/access/v1/access-request/req_1"), { params: Promise.resolve({ id: "req_1" }) })
    const body = await res.json()
    expect(body.task.status).toBe("pending")
  })

  it("carries the grant as the AARP approval once approved", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...baseRow, status: "approved", decisionNote: "Approved by owner" })
    const expiresAt = new Date(Date.now() + 15 * 60_000)
    dbMock.grant.findFirst.mockResolvedValue({ id: "grant_1", status: "active", expiresAt, createdAt: new Date() })
    const res = await taskStatus(getReq("/api/access/v1/access-request/req_1"), { params: Promise.resolve({ id: "req_1" }) })
    const body = await res.json()
    expect(body.task.status).toBe("approved")
    expect(body.result.mode).toBe("reevaluate")
    expect(body.result.approval.id).toBe("grant_1")
    expect(body.result.approval.status).toBe("active")
    expect(body.result.approval.approved_until).toBe(expiresAt.toISOString())
  })

  it("shows a consumed grant as spent, not as a fresh approval", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ ...baseRow, status: "approved", decisionNote: "Grant consumed" })
    dbMock.grant.findFirst.mockResolvedValue({
      id: "grant_1",
      status: "consumed",
      expiresAt: new Date(Date.now() + 5 * 60_000),
      createdAt: new Date(),
    })
    const res = await taskStatus(getReq("/api/access/v1/access-request/req_1"), { params: Promise.resolve({ id: "req_1" }) })
    expect((await res.json()).result.approval.status).toBe("consumed")
  })

  it("maps a policy-timeout settlement to expired", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      ...baseRow,
      status: "denied",
      decisionNote: "Escalation timed out after 30m — auto-denied by policy",
    })
    const res = await taskStatus(getReq("/api/access/v1/access-request/req_1"), { params: Promise.resolve({ id: "req_1" }) })
    expect((await res.json()).task.status).toBe("expired")
  })

  it("404s with unknown_task for another wallet's task", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      ...baseRow,
      agent: { walletId: "wallet_other", wallet: { policy: POLICY } },
    })
    const res = await taskStatus(getReq("/api/access/v1/access-request/req_1"), { params: Promise.resolve({ id: "req_1" }) })
    expect(res.status).toBe(404)
    expect((await res.json()).type).toContain("unknown_task")
  })
})

describe("re-evaluation with context.approval", () => {
  const activeToolGrant = {
    id: "grant_1",
    walletId: WID,
    agentId: AID,
    actionType: "tool.invoke",
    status: "active",
    resourceJson: { kind: "tool", tool: "github.merge_pr", server: null },
    sourceType: "authorization_request",
    sourceId: "req_1",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  }

  const redemption = { ...escalatedTool, context: { approval: { id: "grant_1" } } }

  it("redeems the grant atomically and permits", async () => {
    dbMock.grant.findUnique.mockResolvedValue(activeToolGrant)
    const res = await evaluation(req("/api/access/v1/evaluation", redemption))
    const body = await res.json()
    expect(body.decision).toBe(true)
    expect(body.context.code).toBe("GRANT_CONSUMED")
    expect(dbMock.grant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "consumed" }) }),
    )
  })

  it("denies a replayed approval with approval_expired / request", async () => {
    dbMock.grant.findUnique.mockResolvedValue({ ...activeToolGrant, status: "consumed" })
    const res = await evaluation(req("/api/access/v1/evaluation", redemption))
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("GRANT_ALREADY_USED")
    expect(body.context.aarp_reason).toBe("approval_expired")
    expect(body.context.next_action).toBe("request")
  })

  it("denies an out-of-scope redemption when the tuple differs from the approval", async () => {
    dbMock.grant.findUnique.mockResolvedValue(activeToolGrant)
    const other = { ...redemption, resource: { type: "tool", id: "some.other.tool" } }
    const res = await evaluation(req("/api/access/v1/evaluation", other))
    const body = await res.json()
    expect(body.context.code).toBe("GRANT_MISMATCH")
    expect(body.context.aarp_reason).toBe("out_of_scope")
    expect(body.context.next_action).toBe("request")
  })

  it("redeems a provision grant with the exact approved shape", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      ...activeToolGrant,
      actionType: "provision.allocate",
      resourceJson: {
        kind: "provision",
        resource: "azure:seat",
        line_item: "M365 E3",
        quantity: 2,
        amount_usd: 60,
        category: "software",
        description: null,
      },
    })
    const provision = {
      subject,
      action: { name: "allocate", properties: { amount_usd: 60, quantity: 2, line_item: "M365 E3", category: "software" } },
      resource: { type: "provision", id: "azure:seat" },
      context: { approval: { id: "grant_1" } },
    }
    const res = await evaluation(req("/api/access/v1/evaluation", provision))
    expect((await res.json()).decision).toBe(true)
  })

  it("maps a subtree-cap breach during redemption to policy_denied", async () => {
    const { CascadeBudgetExceeded, reserveCascadeDailySpend } = await import("../lib/cascadeBudget")
    vi.mocked(reserveCascadeDailySpend).mockRejectedValueOnce(new CascadeBudgetExceeded("wallet_parent", 1000, new Date()))
    dbMock.grant.findUnique.mockResolvedValue({
      ...activeToolGrant,
      actionType: "spend.purchase",
      resourceJson: { kind: "spend", action: "purchase", amount_usd: 60, merchant: "github", category: "general", description: null },
    })
    const spend = {
      subject,
      action: { name: "purchase", properties: { amount_usd: 60 } },
      resource: { type: "spend", id: "github" },
      context: { approval: { id: "grant_1" } },
    }
    const res = await evaluation(req("/api/access/v1/evaluation", spend))
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("SUBTREE_CAP_EXCEEDED")
    expect(body.context.aarp_reason).toBe("policy_denied")
  })

  it("400s a provision redemption whose arithmetic is inconsistent", async () => {
    const provision = {
      subject,
      action: { name: "allocate", properties: { amount_usd: 5, quantity: 2, unit_price_usd: 3 } },
      resource: { type: "provision", id: "azure:seat" },
      context: { approval: { id: "grant_1" } },
    }
    const res = await evaluation(req("/api/access/v1/evaluation", provision))
    expect(res.status).toBe(400)
  })

  it("400s a context.approval without a string id", async () => {
    const res = await evaluation(
      req("/api/access/v1/evaluation", { ...escalatedTool, context: { approval: { id: 42 } } }),
    )
    expect(res.status).toBe(400)
  })

  it("redeems a spend grant through the locked transaction", async () => {
    dbMock.grant.findUnique.mockResolvedValue({
      ...activeToolGrant,
      actionType: "spend.purchase",
      resourceJson: { kind: "spend", action: "purchase", amount_usd: 60, merchant: "github", category: "general", description: null },
    })
    const spend = {
      subject,
      action: { name: "purchase", properties: { amount_usd: 60 } },
      resource: { type: "spend", id: "github" },
      context: { approval: { id: "grant_1" } },
    }
    const res = await evaluation(req("/api/access/v1/evaluation", spend))
    expect((await res.json()).decision).toBe(true)
    expect(dbMock.$executeRaw).toHaveBeenCalled() // advisory lock taken
  })
})

describe("GET /.well-known/authzen-configuration", () => {
  it("advertises the endpoints and the access-request capability", async () => {
    const res = await wellKnown(getReq("/.well-known/authzen-configuration", { key: null }))
    const body = await res.json()
    expect(body.access_evaluation_endpoint).toBe("https://test.local/api/access/v1/evaluation")
    expect(body.access_request_endpoint).toBe("https://test.local/api/access/v1/access-request")
    expect(body.capabilities).toContain("urn:openid:authzen:capability:access-request")
  })

  it("SANCTION_PUBLIC_ORIGIN pins the advertised origin over the request host", async () => {
    process.env.SANCTION_PUBLIC_ORIGIN = "https://getsanction.com"
    try {
      const res = await wellKnown(getReq("/.well-known/authzen-configuration", { key: null }))
      expect((await res.json()).access_request_endpoint).toBe("https://getsanction.com/api/access/v1/access-request")
      const offer = await obtainOffer()
      expect(offer.endpoint).toBe("https://getsanction.com/api/access/v1/access-request")
    } finally {
      delete process.env.SANCTION_PUBLIC_ORIGIN
    }
  })
})
