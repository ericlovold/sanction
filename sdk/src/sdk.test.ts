import { describe, it, expect } from "vitest"
import { SanctionClient } from "./client"
import { SanctionAdminClient, policyToWire, policyFromWire } from "./admin"
import { AuthorizationDeniedError, SanctionError } from "./errors"
import type { Fetch } from "./types"

type Call = { url: string; init: RequestInit }

// Builds a fake fetch that records calls and replies with a queued response.
function fakeFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = []
  let i = 0
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const r = responses[i++] ?? { ok: true, status: 200, body: {} }
    return {
      ok: r.ok,
      status: r.status,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
    } as Response
  }) as unknown as Fetch
  return { fetch, calls }
}

const BASE = "https://api.test/v1"

// A full snake_case dollar policy as the API returns it.
const WIRE_POLICY = {
  daily_token_budget_usd: 10,
  daily_spend_budget_usd: 50,
  subtree_daily_cap_usd: null,
  per_transaction_max_usd: 100,
  auto_approve_under_usd: 10,
  escalate_over_usd: 25,
  allowed_categories: ["software"],
  blocked_categories: ["crypto"],
  allowed_tools: [],
  blocked_tools: [],
  escalate_tools: ["github.delete_repo"],
  escalation_timeout_mins: 60,
  escalation_timeout_action: "deny" as const,
}

describe("SanctionClient.authorize", () => {
  it("returns an approved decision and sends snake_case body + api key", async () => {
    const { fetch, calls } = fakeFetch([
      { ok: true, status: 200, body: { authorized: true, status: "approved", request_id: "req_1", agent: "a", amount_usd: 3.5, merchant: "anthropic" } },
    ])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    const d = await client.authorize({ action: "purchase", amountUsd: 3.5, merchant: "anthropic", category: "software", idempotencyKey: "job-1" })

    expect(d.status).toBe("approved")
    expect(d.authorized).toBe(true)
    expect(calls[0].url).toBe(`${BASE}/authorize`)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe("pxy_x")
    expect(headers["idempotency-key"]).toBe("job-1")
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ action: "purchase", amount_usd: 3.5, merchant: "anthropic", category: "software" })
  })

  it("RETURNS (does not throw) a denied decision delivered as HTTP 403", async () => {
    const { fetch } = fakeFetch([
      { ok: false, status: 403, body: { authorized: false, status: "denied", request_id: "req_2", reason: "Daily spend budget exceeded", code: "DAILY_BUDGET_EXCEEDED", agent: "a", amount_usd: 9, merchant: "x" } },
    ])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    const d = await client.authorize({ action: "purchase", amountUsd: 9, merchant: "x", category: "software" })
    expect(d.status).toBe("denied")
    expect(d.code).toBe("DAILY_BUDGET_EXCEEDED")
  })

  it("throws AuthorizationDeniedError on a denial when throwOnDeny is set", async () => {
    const { fetch } = fakeFetch([
      { ok: false, status: 403, body: { authorized: false, status: "denied", request_id: "r", reason: "blocked", code: "CATEGORY_BLOCKED", agent: "a", amount_usd: 1, merchant: "x" } },
    ])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    await expect(client.authorize({ action: "purchase", amountUsd: 1, merchant: "x", category: "gambling" }, { throwOnDeny: true }))
      .rejects.toBeInstanceOf(AuthorizationDeniedError)
  })

  it("throws SanctionError on an auth failure (401, no decision body)", async () => {
    const { fetch } = fakeFetch([{ ok: false, status: 401, body: { error: "Invalid API key" } }])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    await expect(client.authorize({ action: "purchase", amountUsd: 1, merchant: "x", category: "software" }))
      .rejects.toMatchObject({ name: "SanctionError", status: 401 })
  })
})

describe("SanctionClient data-plane wire mapping", () => {
  it("requestExecutionToken sends snake_case and maps the response to camelCase", async () => {
    const { fetch, calls } = fakeFetch([
      { ok: true, status: 200, body: { jwt: "j", jti: "t1", expires_at: "2026-01-01T00:00:00Z", clearance: 2, scope: ["github"], budget_usd: 5, ttl_seconds: 900 } },
    ])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    const tok = await client.requestExecutionToken({ scope: ["github"], budgetUsd: 5, ttlSeconds: 900 })
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ scope: ["github"], budget_usd: 5, ttl_seconds: 900 })
    expect(tok).toMatchObject({ jti: "t1", expiresAt: "2026-01-01T00:00:00Z", budgetUsd: 5, ttlSeconds: 900 })
  })

  it("getStats maps the snake_case stats body to camelCase", async () => {
    const { fetch } = fakeFetch([
      { ok: true, status: 200, body: { today: { token_cost_usd: 1.5, tokens_in: 100, tokens_out: 50, spend_usd: 4 }, month: { token_cost_usd: 12, spend_usd: 40 }, pending_approvals: 2 } },
    ])
    const client = new SanctionClient("pxy_x", { baseUrl: BASE, fetch })
    const s = await client.getStats("w1")
    expect(s.today).toEqual({ tokenCostUsd: 1.5, tokensIn: 100, tokensOut: 50, spendUsd: 4 })
    expect(s.pendingApprovals).toBe(2)
  })
})

describe("SanctionAdminClient policy — snake_case dollar wire", () => {
  it("updatePolicy sends snake_case dollars + wallet_id with the mgmt key", async () => {
    const { fetch, calls } = fakeFetch([{ ok: true, status: 200, body: { wallet_id: "w1", policy: WIRE_POLICY } }])
    const admin = new SanctionAdminClient("sk_x", { baseUrl: BASE, fetch })
    const policy = await admin.updatePolicy("w1", { escalateOverUsd: 25, perTransactionMaxUsd: 100 })

    expect(calls[0].url).toBe(`${BASE}/wallets/policy`)
    expect(calls[0].init.method).toBe("PATCH")
    expect((calls[0].init.headers as Record<string, string>)["x-mgmt-key"]).toBe("sk_x")
    // The wire body MUST be snake_case or the API silently drops the fields.
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ wallet_id: "w1", escalate_over_usd: 25, per_transaction_max_usd: 100 })
    // Response mapped back to camelCase dollars.
    expect(policy.escalateOverUsd).toBe(25)
    expect(policy.escalateTools).toEqual(["github.delete_repo"])
  })

  it("getPolicy maps the snake_case dollar response to camelCase", async () => {
    const { fetch } = fakeFetch([{ ok: true, status: 200, body: { wallet_id: "w1", policy: WIRE_POLICY } }])
    const admin = new SanctionAdminClient("sk_x", { baseUrl: BASE, fetch })
    const p = await admin.getPolicy("w1")
    expect(p.dailySpendBudgetUsd).toBe(50)
    expect(p.subtreeDailyCapUsd).toBeNull()
    expect(p.escalationTimeoutAction).toBe("deny")
  })

  it("applyBlueprint sends only the blueprint's policy block, as snake_case", async () => {
    const { fetch, calls } = fakeFetch([{ ok: true, status: 200, body: { wallet_id: "w1", policy: WIRE_POLICY } }])
    const admin = new SanctionAdminClient("sk_x", { baseUrl: BASE, fetch })
    const blueprint = { _meta: { blueprint: "x" }, policy: { dailySpendBudgetUsd: 50, blockedCategories: ["crypto"] } }
    await admin.applyBlueprint("w1", blueprint)

    expect(JSON.parse(calls[0].init.body as string)).toEqual({ wallet_id: "w1", daily_spend_budget_usd: 50, blocked_categories: ["crypto"] })
  })

  it("createWallet maps the one-time management key", async () => {
    const { fetch, calls } = fakeFetch([
      { ok: true, status: 201, body: { id: "w1", name: "n", owner_email: "e@x.com", management_key: "sk_secret", management_key_prefix: "sk_se" } },
    ])
    const w = await SanctionAdminClient.createWallet({ name: "n", ownerEmail: "e@x.com" }, { baseUrl: BASE, fetch })
    expect(w.managementKey).toBe("sk_secret")
    expect(w.id).toBe("w1")
    // sign-up is unauthenticated — no mgmt key header
    expect((calls[0].init.headers as Record<string, string>)["x-mgmt-key"]).toBeUndefined()
  })
})

describe("policy wire mapping is total and reversible", () => {
  it("policyToWire drops undefined fields and renames the rest", () => {
    expect(policyToWire({ dailySpendBudgetUsd: 50, subtreeDailyCapUsd: null })).toEqual({
      daily_spend_budget_usd: 50,
      subtree_daily_cap_usd: null,
    })
  })

  it("policyFromWire round-trips a full policy", () => {
    const p = policyFromWire(WIRE_POLICY)
    expect(p.dailyTokenBudgetUsd).toBe(10)
    expect(p.perTransactionMaxUsd).toBe(100)
    expect(p.escalationTimeoutMins).toBe(60)
  })
})

describe("constructors guard missing keys", () => {
  it("throws without an agent key", () => {
    expect(() => new SanctionClient("")).toThrow()
  })
  it("throws without a management key", () => {
    expect(() => new SanctionAdminClient("")).toThrow()
  })
  it("exports the error classes", () => {
    expect(SanctionError).toBeTypeOf("function")
  })
})
