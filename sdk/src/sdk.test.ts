import { describe, it, expect } from "vitest"
import { SanctionClient } from "./client"
import { SanctionAdminClient } from "./admin"
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

describe("SanctionAdminClient policy", () => {
  it("updatePolicy sends camelCase cents + wallet_id with the mgmt key", async () => {
    const { fetch, calls } = fakeFetch([{ ok: true, status: 200, body: { wallet_id: "w1", policy: { escalateOverUsd: 500, updatedAt: "t" } } } as never])
    const admin = new SanctionAdminClient("sk_x", { baseUrl: BASE, fetch })
    await admin.updatePolicy("w1", { escalateOverUsd: 500, perTransactionMaxUsd: 2000 })

    expect(calls[0].url).toBe(`${BASE}/wallets/policy`)
    expect(calls[0].init.method).toBe("PATCH")
    expect((calls[0].init.headers as Record<string, string>)["x-mgmt-key"]).toBe("sk_x")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ wallet_id: "w1", escalateOverUsd: 500, perTransactionMaxUsd: 2000 })
  })

  it("applyBlueprint sends only the blueprint's policy block", async () => {
    const { fetch, calls } = fakeFetch([{ ok: true, status: 200, body: { wallet_id: "w1", policy: {} } } as never])
    const admin = new SanctionAdminClient("sk_x", { baseUrl: BASE, fetch })
    const blueprint = { _meta: { blueprint: "x" }, policy: { dailySpendBudgetUsd: 5000, blockedCategories: ["crypto"] } }
    await admin.applyBlueprint("w1", blueprint)

    expect(JSON.parse(calls[0].init.body as string)).toEqual({ wallet_id: "w1", dailySpendBudgetUsd: 5000, blockedCategories: ["crypto"] })
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
