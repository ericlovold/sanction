import { describe, it, expect } from "vitest"
import { SanctionClient } from "./client"
import { SanctionMiddleware, authorizeToolCall, sanctionTool, SanctionToolBlocked } from "./adapters"
import type { Fetch } from "./types"

function fakeFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>): {
  fetch: Fetch
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const r = responses[i++] ?? { ok: true, status: 200, body: {} }
    return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.body) } as Response
  }) as unknown as Fetch
  return { fetch, calls }
}

const BASE = "https://api.test/v1"
const approved = { ok: true, status: 200, body: { authorized: true, status: "allowed", request_id: "req_1" } }
const escalated = { ok: true, status: 200, body: { authorized: false, status: "escalated", request_id: "req_2", code: "TOOL_ESCALATION_REQUIRED" } }
const denied = { ok: true, status: 403, body: { authorized: false, status: "denied", request_id: "req_3", code: "TOOL_BLOCKED", reason: "blocked" } }

describe("SanctionClient.authorizeTool", () => {
  it("normalizes the tool route's 'allowed' status to 'approved'", async () => {
    const { fetch, calls } = fakeFetch([approved])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const d = await c.authorizeTool({ tool: "github.create_pr", server: "github", input: { title: "x" } })
    expect(d).toMatchObject({ authorized: true, status: "approved", requestId: "req_1" })
    expect(calls[0].url).toBe(`${BASE}/authorize/tool`)
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ tool: "github.create_pr", server: "github" })
  })

  it("returns denied/escalated as decisions, never throws", async () => {
    const c1 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    expect((await c1.authorizeTool({ tool: "shell.exec" })).status).toBe("denied")
    const c2 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([escalated]).fetch })
    expect((await c2.authorizeTool({ tool: "github.merge" })).status).toBe("escalated")
  })

  it("fails CLOSED (denied) when Sanction is unreachable — an ungoverned tool must not run", async () => {
    const fetch = (async () => { throw new Error("network down") }) as unknown as Fetch
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const d = await c.authorizeTool({ tool: "shell.exec" })
    expect(d).toMatchObject({ status: "denied", code: "POLICY_DENIED" })
  })

  it("surfaces 401 as an error (bad key, not a policy denial)", async () => {
    const c = new SanctionClient("pxy_bad", { baseUrl: BASE, fetch: fakeFetch([{ ok: false, status: 401, body: { error: "Invalid API key" } }]).fetch })
    await expect(c.authorizeTool({ tool: "x" })).rejects.toThrow(/Invalid API key/)
  })
})

describe("SanctionMiddleware", () => {
  it("runs the tool only on approval", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([approved]).fetch })
    const runTool = SanctionMiddleware(c)
    let ran = false
    const out = await runTool({ tool: "deploy", server: "ci", run: () => { ran = true; return "shipped" } })
    expect(ran).toBe(true)
    expect(out).toBe("shipped")
  })

  it("throws SanctionToolBlocked and does NOT run the tool on denial", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    const runTool = SanctionMiddleware(c)
    let ran = false
    await expect(runTool({ tool: "shell.exec", run: () => { ran = true } })).rejects.toBeInstanceOf(SanctionToolBlocked)
    expect(ran).toBe(false)
  })

  it("escalation carries the request id for grant polling", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([escalated]).fetch })
    const runTool = SanctionMiddleware(c)
    await runTool({ tool: "github.merge", run: () => "no" }).catch((e: SanctionToolBlocked) => {
      expect(e.status).toBe("escalated")
      expect(e.requestId).toBe("req_2")
    })
  })
})

describe("authorizeToolCall (branch-not-throw)", () => {
  it("hands back the decision + a run thunk without executing", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    let ran = false
    const { decision, run } = await authorizeToolCall(c, { tool: "shell.exec", run: () => { ran = true } })
    expect(decision.status).toBe("denied")
    expect(ran).toBe(false) // caller decides whether to run
    void run
  })
})

describe("sanctionTool (Vercel AI SDK)", () => {
  it("gates execute — runs on approval, throws on denial", async () => {
    const c1 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([approved]).fetch })
    const t1 = sanctionTool(c1, "deploy", { description: "d", execute: async (a: unknown) => ({ ok: a }) }, { server: "ci" })
    expect(await t1.execute({ env: "prod" })).toEqual({ ok: { env: "prod" } })

    const c2 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    let ran = false
    const t2 = sanctionTool(c2, "shell", { execute: async (_a: unknown) => { ran = true } })
    await expect(t2.execute({})).rejects.toBeInstanceOf(SanctionToolBlocked)
    expect(ran).toBe(false)
  })

  it("leaves a tool with no execute untouched", () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([]).fetch })
    const t = sanctionTool(c, "noop", { description: "just a schema" } as { description: string; execute?: (a: unknown) => unknown })
    expect(t.execute).toBeUndefined()
  })

  it("redeems a grantId on retry after escalation", async () => {
    const { fetch, calls } = fakeFetch([approved])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const t = sanctionTool(c, "deploy", { execute: async (_a: unknown) => "ok" }, { server: "ci", grantId: "grant_1" })
    expect(await t.execute({})).toBe("ok")
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ tool: "deploy", grant_id: "grant_1" })
  })
})

describe("SanctionClient.getAuthorization", () => {
  it("polls an escalated request and surfaces the grant when approved", async () => {
    const { fetch, calls } = fakeFetch([
      {
        ok: true,
        status: 200,
        body: {
          authorized: true,
          status: "approved",
          request_id: "req_2",
          grant_id: "grant_abc",
          grant_status: "active",
          agent: "tenet",
        },
      },
    ])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const s = await c.getAuthorization("req_2")
    expect(s).toMatchObject({ status: "approved", requestId: "req_2", grantId: "grant_abc", grantStatus: "active" })
    expect(calls[0].url).toBe(`${BASE}/authorize/req_2`)
  })

  it("returns escalated while still waiting", async () => {
    const c = new SanctionClient("pxy_k", {
      baseUrl: BASE,
      fetch: fakeFetch([{ ok: true, status: 200, body: { authorized: false, status: "escalated", request_id: "req_2" } }]).fetch,
    })
    expect((await c.getAuthorization("req_2")).status).toBe("escalated")
  })
})

// ── sanctionedFetch (pay-per-crawl 402 gate) ─────────────────────────────────

import { sanctionedFetch, parseCrawlPrice, SanctionCrawlBlocked } from "./adapters"

const spendApproved = { ok: true, status: 200, body: { authorized: true, status: "approved", request_id: "req_s1", agent: "tenet", amount_usd: 0.05, merchant: "example.com" } }
const spendEscalated = { ok: true, status: 200, body: { authorized: false, status: "escalated", request_id: "req_s2", agent: "tenet", amount_usd: 0.05, merchant: "example.com", code: "ESCALATION_REQUIRED" } }
const spendDenied = { ok: true, status: 403, body: { authorized: false, status: "denied", request_id: "req_s3", agent: "tenet", amount_usd: 0.05, merchant: "example.com", code: "CATEGORY_BLOCKED", reason: "blocked" } }

function webResponse(status: number, headers: Record<string, string> = {}): Response {
  return { status, headers: new Headers(headers) } as unknown as Response
}

function fakeWeb(responses: Response[]): { fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return responses[i++] ?? webResponse(200)
    },
  }
}

describe("parseCrawlPrice", () => {
  it("parses the documented USD form and tolerant variants", () => {
    expect(parseCrawlPrice("USD 0.01")).toBe(0.01)
    expect(parseCrawlPrice("usd 1.50")).toBe(1.5)
    expect(parseCrawlPrice("$0.05")).toBe(0.05)
    expect(parseCrawlPrice("0.05")).toBe(0.05)
  })
  it("rejects junk, zero, negatives, and non-USD", () => {
    expect(parseCrawlPrice(null)).toBeNull()
    expect(parseCrawlPrice("")).toBeNull()
    expect(parseCrawlPrice("EUR 0.05")).toBeNull()
    expect(parseCrawlPrice("USD 0")).toBeNull()
    expect(parseCrawlPrice("free")).toBeNull()
  })
})

describe("sanctionedFetch", () => {
  it("passes non-402 responses through without authorizing", async () => {
    const api = fakeFetch([])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([webResponse(200)])
    const res = await sanctionedFetch(client, web.fetch)("https://example.com/a")
    expect(res.status).toBe(200)
    expect(api.calls).toHaveLength(0)
    expect(web.calls).toHaveLength(1)
  })

  it("passes a 402 WITHOUT a parseable crawler-price through (not a crawl offer)", async () => {
    const api = fakeFetch([])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([webResponse(402)])
    const res = await sanctionedFetch(client, web.fetch)("https://example.com/a")
    expect(res.status).toBe(402)
    expect(api.calls).toHaveLength(0)
  })

  it("approved: authorizes the quote and retries echoing crawler-exact-price verbatim", async () => {
    const api = fakeFetch([spendApproved])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([
      webResponse(402, { "crawler-price": "USD 0.05" }),
      webResponse(200, { "crawler-charged": "USD 0.05" }),
    ])
    const res = await sanctionedFetch(client, web.fetch)("https://example.com/article")
    expect(res.status).toBe(200)
    // The authorize call carried the crawl mapping: merchant = host, tags on.
    const body = JSON.parse(String(api.calls[0].init.body))
    expect(body).toMatchObject({
      action: "purchase",
      amount_usd: 0.05,
      merchant: "example.com",
      category: "content-access",
      tags: { channel: "pay-per-crawl", url: "https://example.com/article" },
    })
    // The retry echoed the site's own quote, exact-match semantics.
    const retryHeaders = new Headers(web.calls[1].init?.headers)
    expect(retryHeaders.get("crawler-exact-price")).toBe("USD 0.05")
  })

  it("escalated: throws SanctionCrawlBlocked carrying the request id and quote — no paid retry", async () => {
    const api = fakeFetch([spendEscalated])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([webResponse(402, { "crawler-price": "USD 0.05" })])
    const err = await sanctionedFetch(client, web.fetch)("https://example.com/a").catch((e) => e)
    expect(err).toBeInstanceOf(SanctionCrawlBlocked)
    expect(err.status).toBe("escalated")
    expect(err.requestId).toBe("req_s2")
    expect(err.priceUsd).toBe(0.05)
    expect(web.calls).toHaveLength(1) // never retried with payment intent
  })

  it("denied: throws with the machine code — no paid retry", async () => {
    const api = fakeFetch([spendDenied])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([webResponse(402, { "crawler-price": "USD 0.05" })])
    const err = await sanctionedFetch(client, web.fetch)("https://example.com/a").catch((e) => e)
    expect(err).toBeInstanceOf(SanctionCrawlBlocked)
    expect(err.status).toBe("denied")
    expect(err.code).toBe("CATEGORY_BLOCKED")
    expect(web.calls).toHaveLength(1)
  })

  it("honors custom category and merged tags, and reports via onDecision", async () => {
    const api = fakeFetch([spendApproved])
    const client = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: api.fetch })
    const web = fakeWeb([webResponse(402, { "crawler-price": "USD 0.05" }), webResponse(200)])
    const seen: Array<{ url: string; priceUsd: number; status: string }> = []
    const f = sanctionedFetch(client, web.fetch, {
      category: "research-data",
      tags: { play: "market-scan" },
      onDecision: (d, url, priceUsd) => seen.push({ url, priceUsd, status: d.status }),
    })
    await f("https://example.com/report")
    const body = JSON.parse(String(api.calls[0].init.body))
    expect(body.category).toBe("research-data")
    expect(body.tags).toMatchObject({ channel: "pay-per-crawl", play: "market-scan" })
    expect(seen).toEqual([{ url: "https://example.com/report", priceUsd: 0.05, status: "approved" }])
  })
})
