import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests for the OpenID AuthZEN 1.0 PDP surface —
// POST /access/v1/evaluation and /access/v1/evaluations — with a mocked
// Prisma client. Covers the wire contract (deny is HTTP 200 decision:false,
// X-Request-ID echo, 400/401 failures), the SARC → engine mapping for
// tool/spend/provision resource types, subject binding to the authenticated
// agent, and the three batch evaluation semantics. Decision-only: these
// endpoints must never write.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// Cascade math is proven in cascadeBudget.test.ts; stub the db-touching fns
// (no ancestors, no subtree caps) and keep the pure helpers real.
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return {
    ...mod,
    walletAncestorChain: vi.fn(async () => []),
    cascadeDailyWouldExceed: vi.fn(async () => false),
  }
})

import { POST as evaluation } from "../app/api/access/v1/evaluation/route"
import { POST as evaluations } from "../app/api/access/v1/evaluations/route"
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
  monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: ["gambling"],
  allowedTools: [],
  blockedTools: ["shell.exec"],
  escalateTools: ["github.merge_pr"],
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

function req(path: string, body: unknown, opts: { key?: string | null; requestId?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  if (opts.requestId) headers["x-request-id"] = opts.requestId
  return new NextRequest(`https://test.local/api${path}`, { method: "POST", headers, body: JSON.stringify(body) })
}

const subject = { type: "agent", id: AID }
const toolCall = (tool: string) => ({
  subject,
  action: { name: "invoke" },
  resource: { type: "tool", id: tool },
})
const spend = (amountUsd: number, extra: Record<string, unknown> = {}) => ({
  subject,
  action: { name: "purchase", properties: { amount_usd: amountUsd, ...extra } },
  resource: { type: "spend", id: "github" },
})

beforeAll(() => {
  // Escalate outcomes sign an AARP binding token (requestable denials).
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 0 } })
  vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(false)
})

describe("POST /access/v1/evaluation — wire contract", () => {
  it("401s without an API key", async () => {
    const res = await evaluation(req("/access/v1/evaluation", toolCall("search"), { key: null }))
    expect(res.status).toBe(401)
  })

  it("400s on a malformed request (missing resource)", async () => {
    const res = await evaluation(req("/access/v1/evaluation", { subject, action: { name: "invoke" } }))
    expect(res.status).toBe(400)
  })

  it("echoes X-Request-ID on the response", async () => {
    const res = await evaluation(req("/access/v1/evaluation", toolCall("search"), { requestId: "rid-42" }))
    expect(res.headers.get("x-request-id")).toBe("rid-42")
  })

  it("returns a deny as HTTP 200 with decision:false (per spec)", async () => {
    const res = await evaluation(req("/access/v1/evaluation", toolCall("shell.exec")))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("TOOL_BLOCKED")
  })

  it("never persists anything", async () => {
    await evaluation(req("/access/v1/evaluation", spend(60)))
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })
})

describe("subject binding", () => {
  it("denies with SUBJECT_MISMATCH when subject.id is another agent", async () => {
    const body = { ...toolCall("search"), subject: { type: "agent", id: "agent_other" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    expect(res.status).toBe(200)
    expect((await res.json()).context.code).toBe("SUBJECT_MISMATCH")
  })

  it("accepts the agent's name as subject.id", async () => {
    const body = { ...toolCall("search"), subject: { type: "agent", id: "tenet" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    expect((await res.json()).decision).toBe(true)
  })
})

describe("resource.type = tool", () => {
  it("permits a tool no list governs", async () => {
    const res = await evaluation(req("/access/v1/evaluation", toolCall("search")))
    expect(await res.json()).toEqual({ decision: true })
  })

  it("maps an escalate-listed tool to decision:false with the open-approval pointer", async () => {
    const res = await evaluation(req("/access/v1/evaluation", toolCall("github.merge_pr")))
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("TOOL_ESCALATION_REQUIRED")
    expect(body.context.remediation).toContain("/api/v1/authorize/tool")
  })

  it("denies a tool outside a non-empty allow-list", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...POLICY, allowedTools: ["search"] } },
    })
    const res = await evaluation(req("/access/v1/evaluation", toolCall("browser.open")))
    expect((await res.json()).context.code).toBe("TOOL_NOT_ALLOWED")
  })
})

describe("resource.type = spend", () => {
  it("permits under the auto-approve floor", async () => {
    const res = await evaluation(req("/access/v1/evaluation", spend(5)))
    expect(await res.json()).toEqual({ decision: true })
  })

  it("maps over-escalation-threshold to decision:false ESCALATION_REQUIRED", async () => {
    const res = await evaluation(req("/access/v1/evaluation", spend(60)))
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("ESCALATION_REQUIRED")
    expect(body.context.remediation).toContain("/api/v1/authorize")
  })

  it("denies over the per-transaction cap", async () => {
    const res = await evaluation(req("/access/v1/evaluation", spend(150)))
    expect((await res.json()).context.code).toBe("PER_TXN_LIMIT")
  })

  it("denies a blocked category", async () => {
    const res = await evaluation(req("/access/v1/evaluation", spend(5, { category: "gambling" })))
    expect((await res.json()).context.code).toBe("CATEGORY_BLOCKED")
  })

  it("denies when live daily spend state exhausts the budget", async () => {
    // Same value for the daily and monthly reads — order-independent.
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 9_999 } })
    const res = await evaluation(req("/access/v1/evaluation", spend(50)))
    expect((await res.json()).context.code).toBe("DAILY_BUDGET_EXCEEDED")
  })

  it("denies when an ancestor subtree cap would be exceeded", async () => {
    vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(true)
    const res = await evaluation(req("/access/v1/evaluation", spend(5)))
    expect((await res.json()).context.code).toBe("SUBTREE_CAP_EXCEEDED")
  })

  it("400s without a positive amount_usd property", async () => {
    const body = { subject, action: { name: "purchase" }, resource: { type: "spend", id: "github" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    expect(res.status).toBe(400)
  })
})

describe("resource.type = provision", () => {
  const provision = (props: Record<string, unknown>) => ({
    subject,
    action: { name: "allocate", properties: props },
    resource: { type: "provision", id: "azure:seat" },
  })

  it("permits an ungoverned resource under the floor", async () => {
    const res = await evaluation(req("/access/v1/evaluation", provision({ amount_usd: 5 })))
    expect(await res.json()).toEqual({ decision: true })
  })

  it("denies a blocked resource", async () => {
    const body = { ...provision({ amount_usd: 5 }), resource: { type: "provision", id: "aws:root-account" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    expect((await res.json()).context.code).toBe("RESOURCE_BLOCKED")
  })

  it("escalates an escalate-listed resource regardless of amount", async () => {
    const body = { ...provision({ amount_usd: 5 }), resource: { type: "provision", id: "azure:seat:premium" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    const parsed = await res.json()
    expect(parsed.decision).toBe(false)
    expect(parsed.context.code).toBe("ESCALATION_REQUIRED")
  })

  it("400s when quantity × unit_price_usd ≠ amount_usd", async () => {
    const res = await evaluation(
      req("/access/v1/evaluation", provision({ amount_usd: 5, quantity: 2, unit_price_usd: 3 })),
    )
    expect(res.status).toBe(400)
  })
})

describe("edge mappings", () => {
  it("denies an unsupported resource.type with UNSUPPORTED_RESOURCE_TYPE", async () => {
    const body = { subject, action: { name: "read" }, resource: { type: "document", id: "doc_1" } }
    const res = await evaluation(req("/access/v1/evaluation", body))
    expect((await res.json()).context.code).toBe("UNSUPPORTED_RESOURCE_TYPE")
  })

  it("denies with NO_POLICY when the wallet has no policy", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, wallet: { ...AGENT.wallet, policy: null } })
    const res = await evaluation(req("/access/v1/evaluation", toolCall("search")))
    expect((await res.json()).context.code).toBe("NO_POLICY")
  })
})

describe("POST /access/v1/evaluations — batch", () => {
  const defaults = { subject, action: { name: "invoke" } }

  it("evaluates every item under execute_all (default), merging top-level defaults", async () => {
    const body = {
      ...defaults,
      evaluations: [
        { resource: { type: "tool", id: "search" } },
        { resource: { type: "tool", id: "shell.exec" } },
        { resource: { type: "tool", id: "github.merge_pr" } },
      ],
    }
    const res = await evaluations(req("/access/v1/evaluations", body))
    expect(res.status).toBe(200)
    const parsed = await res.json()
    expect(parsed.evaluations.map((e: { decision: boolean }) => e.decision)).toEqual([true, false, false])
  })

  it("stops at the first deny under deny_on_first_deny", async () => {
    const body = {
      ...defaults,
      evaluations: [
        { resource: { type: "tool", id: "shell.exec" } },
        { resource: { type: "tool", id: "search" } },
      ],
      options: { evaluations_semantic: "deny_on_first_deny" },
    }
    const res = await evaluations(req("/access/v1/evaluations", body))
    const parsed = await res.json()
    expect(parsed.evaluations).toHaveLength(1)
    expect(parsed.evaluations[0].decision).toBe(false)
  })

  it("stops at the first permit under permit_on_first_permit", async () => {
    const body = {
      ...defaults,
      evaluations: [
        { resource: { type: "tool", id: "shell.exec" } },
        { resource: { type: "tool", id: "search" } },
        { resource: { type: "tool", id: "github.merge_pr" } },
      ],
      options: { evaluations_semantic: "permit_on_first_permit" },
    }
    const res = await evaluations(req("/access/v1/evaluations", body))
    const parsed = await res.json()
    expect(parsed.evaluations).toHaveLength(2)
    expect(parsed.evaluations[1].decision).toBe(true)
  })

  it("treats a request without an evaluations array as a single evaluation of the defaults", async () => {
    const body = { ...defaults, resource: { type: "tool", id: "search" } }
    const res = await evaluations(req("/access/v1/evaluations", body))
    const parsed = await res.json()
    expect(parsed.evaluations).toEqual([{ decision: true }])
  })

  it("400s naming the index when an item is incomplete after merging defaults", async () => {
    const body = { ...defaults, evaluations: [{ resource: { type: "tool", id: "search" } }, { context: {} }] }
    const res = await evaluations(req("/access/v1/evaluations", body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("index 1")
  })

  it("400s past the batch size cap", async () => {
    const body = {
      ...defaults,
      evaluations: Array.from({ length: 51 }, () => ({ resource: { type: "tool", id: "search" } })),
    }
    const res = await evaluations(req("/access/v1/evaluations", body))
    expect(res.status).toBe(400)
  })

  it("echoes X-Request-ID", async () => {
    const ok = await evaluations(
      req("/access/v1/evaluations", { ...defaults, resource: { type: "tool", id: "search" } }, { requestId: "rid-7" }),
    )
    expect(ok.headers.get("x-request-id")).toBe("rid-7")
  })

  it("401s without a key", async () => {
    const anon = await evaluations(req("/access/v1/evaluations", {}, { key: null }))
    expect(anon.status).toBe(401)
  })
})
