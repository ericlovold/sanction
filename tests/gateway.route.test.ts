import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// The LLM gateway proxy route: provider allowlist, x-sanction-key auth,
// pre-call budget wall (402), header hygiene both directions, JSON metering,
// and the 502 on an unreachable upstream. Pricing/extraction math is proven in
// gateway.test.ts; here we prove the route glue with a mocked upstream fetch.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn(async () => {}) }))
// Budget state + metering write paths have their own tests; stub the db-touchers
// and keep provider configs/parsers real.
vi.mock("@/lib/gateway", async (orig) => {
  const mod = await orig<typeof import("@/lib/gateway")>()
  return {
    ...mod,
    isBudgetExhausted: vi.fn(async () => ({ exhausted: false, spent: 1, budget: 10 })),
    meterUsage: vi.fn(async () => 0.05),
  }
})

import { POST as gateway } from "../app/api/gateway/[provider]/[...path]/route"
import { isBudgetExhausted, meterUsage } from "../lib/gateway"

const KEY = "pxy_testagentkey"
const AGENT = {
  id: "agent_1",
  walletId: "wallet_1",
  name: "tenet",
  isActive: true,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: "wallet_1", ownerEmail: "owner@example.com", policy: null },
}

const realFetch = global.fetch

function req(provider: string, path: string, opts: { key?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-sanction-key"] = opts.key ?? KEY
  return new NextRequest(`https://test.local/api/gateway/${provider}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { model: "claude-sonnet-5", messages: [] }),
  })
}
const params = (provider: string, path: string) => ({ params: Promise.resolve({ provider, path: path.split("/") }) })

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: false, spent: 1, budget: 10 } as never)
})

afterEach(() => {
  global.fetch = realFetch
})

describe("gateway proxy — gates before the upstream call", () => {
  it("404 for an unknown provider, and never calls upstream", async () => {
    global.fetch = vi.fn()
    const res = await gateway(req("nonsense", "v1/messages"), params("nonsense", "v1/messages"))
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("401 without x-sanction-key", async () => {
    const res = await gateway(req("anthropic", "v1/messages", { key: null }), params("anthropic", "v1/messages"))
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("401 for an inactive agent", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, isActive: false })
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(401)
  })

  it("402 before spending when the daily token budget is exhausted", async () => {
    vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: true, spent: 10, budget: 10 } as never)
    global.fetch = vi.fn()
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(402)
    expect((await res.json())).toMatchObject({ daily_limit_usd: 10, daily_spent_usd: 10 })
    expect(global.fetch).not.toHaveBeenCalled() // the wall is BEFORE the provider call
  })

  it("502 when the upstream provider is unreachable", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED") }) as never
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(502)
  })
})

describe("gateway proxy — forwarding and metering", () => {
  it("forwards to the provider base URL, strips Sanction auth from upstream headers, meters JSON usage", async () => {
    const upstreamBody = JSON.stringify({ id: "msg_1", usage: { input_tokens: 100, output_tokens: 50 }, model: "claude-sonnet-5" })
    const fetchMock = vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as never

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(calledUrl)).toContain("anthropic.com")
    expect(String(calledUrl)).toContain("/v1/messages")
    // the Sanction key must never reach the provider
    expect(new Headers(init.headers).get("x-sanction-key")).toBeNull()

    // usage came off the response body and was metered
    expect(meterUsage).toHaveBeenCalledWith("agent_1", "anthropic", expect.objectContaining({ tokensIn: 100, tokensOut: 50 }))

    // response passthrough: body intact, no-store stamped
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).id).toBe("msg_1")
  })

  it("passes through a JSON response with no usage block unmetered", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as never
    const res = await gateway(req("openai", "v1/models"), params("openai", "v1/models"))
    expect(res.status).toBe(200)
    expect(meterUsage).not.toHaveBeenCalled()
  })

  it("passes upstream error statuses through to the client", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529, headers: { "content-type": "application/json" } })) as never
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(529)
  })

  it("meters an SSE stream after it drains, passing the bytes through untouched", async () => {
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":80,"output_tokens":0}}}\n',
      'data: {"type":"message_delta","usage":{"output_tokens":40}}\n',
      "data: [DONE]\n",
    ].join("\n")
    global.fetch = vi.fn(async () =>
      new Response(new Blob([sse]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as never

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    const text = await res.text() // draining the stream fires the flush-time metering
    expect(text).toBe(sse)
    expect(meterUsage).toHaveBeenCalledWith("agent_1", "anthropic", expect.objectContaining({ tokensIn: 80, tokensOut: 40 }))
  })
})
