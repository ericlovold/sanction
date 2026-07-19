import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// The LLM gateway proxy route: provider allowlist, x-sanction-key auth,
// pre-call budget wall (402), header hygiene both directions, JSON metering,
// and the 502 on an unreachable upstream. Pricing/extraction math is proven in
// gateway.test.ts; here we prove the route glue with a mocked upstream fetch.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn() },
    credentialVault: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn(async () => {}) }))
vi.mock("@/lib/credentialCrypto", () => ({ decryptCredentialEnvelope: vi.fn(async () => "vaulted-provider-key") }))
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
import { notifyTokenBudgetThreshold } from "../lib/thresholds"

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

function req(provider: string, path: string, opts: { key?: string | null; body?: unknown; providerAuth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.providerAuth !== false) headers["authorization"] = "Bearer caller-own-key"
  if (opts.key !== null) headers["x-sanction-key"] = opts.key ?? KEY
  return new NextRequest(`https://test.local/api/gateway/${provider}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { model: "claude-sonnet-5", messages: [] }),
  })
}
const params = (provider: string, path: string) => ({ params: Promise.resolve({ provider, path: path.split("/") }) })

beforeEach(() => {
  dbMock.wallet.findUnique.mockResolvedValue({ id: "w_root", parentId: null, frozenAt: null, frozenReason: null }) // KILL-1: routes now read freeze state
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
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json())).toMatchObject({ daily_limit_usd: 10, daily_spent_usd: 10 })
    expect(global.fetch).not.toHaveBeenCalled() // the wall is BEFORE the provider call
  })

  it("502 when the upstream provider is unreachable", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED") }) as never
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(502)
    expect(res.headers.get("cache-control")).toBe("no-store")
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

  it("withholds JSON responses when observed usage cannot be metered", async () => {
    const upstreamBody = JSON.stringify({ id: "msg_1", usage: { input_tokens: 100, output_tokens: 50 }, model: "claude-sonnet-5" })
    global.fetch = vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } })) as never
    vi.mocked(meterUsage).mockRejectedValueOnce(new Error("db down"))

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))

    expect(res.status).toBe(502)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ error: "Sanction metering failed; provider response withheld" })
  })

  it("still returns metered JSON responses when threshold notification fails", async () => {
    const upstreamBody = JSON.stringify({ id: "msg_1", usage: { input_tokens: 100, output_tokens: 50 }, model: "claude-sonnet-5" })
    global.fetch = vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } })) as never
    vi.mocked(notifyTokenBudgetThreshold).mockRejectedValueOnce(new Error("notify down"))

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))

    expect(res.status).toBe(200)
    expect(meterUsage).toHaveBeenCalled()
    expect((await res.json()).id).toBe("msg_1")
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

  const SSE_WITH_USAGE = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":80,"output_tokens":0}}}\n',
    'data: {"type":"message_delta","usage":{"output_tokens":40}}\n',
    "data: [DONE]\n",
  ].join("\n")

  it("retries a transient meter failure at stream end", async () => {
    global.fetch = vi.fn(async () =>
      new Response(new Blob([SSE_WITH_USAGE]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as never
    vi.mocked(meterUsage).mockRejectedValueOnce(new Error("transient blip")) // first attempt fails, retry succeeds

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SSE_WITH_USAGE)
    expect(meterUsage).toHaveBeenCalledTimes(2) // failed once, retried, succeeded
  })

  it("still streams SSE even if metering ultimately fails — enforcement is the pre-call gate, not withholding", async () => {
    global.fetch = vi.fn(async () =>
      new Response(new Blob([SSE_WITH_USAGE]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as never
    vi.mocked(meterUsage).mockRejectedValue(new Error("db down")) // every attempt fails

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    // The client already received the bytes; we can't withhold a live stream.
    // The budget gate fails closed on a DB outage BEFORE the provider call, so
    // a stream that got this far means the read succeeded — the write blip is
    // logged and left as a single-call under-count, not a 502.
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SSE_WITH_USAGE)
    expect(meterUsage).toHaveBeenCalledTimes(3) // bounded retries
  })
})

describe("gateway provider-key injection (Providers page)", () => {
  it("401s PROVIDER_NOT_CONNECTED when caller sends no auth and nothing is vaulted", async () => {
    dbMock.credentialVault.findFirst.mockResolvedValueOnce(null)
    global.fetch = vi.fn() as never
    const res = await gateway(req("anthropic", "v1/messages", { providerAuth: false }), params("anthropic", "v1/messages"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe("PROVIDER_NOT_CONNECTED")
    expect(global.fetch).not.toHaveBeenCalled() // fail closed BEFORE any upstream call
  })

  it("injects the vaulted key in the provider's native header when caller sends none", async () => {
    dbMock.credentialVault.findFirst.mockResolvedValueOnce({ id: "cred_1", walletId: "wallet_1", label: "provider:anthropic", encryptedValue: "x", keyId: "k" })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as never
    const res = await gateway(req("anthropic", "v1/messages", { providerAuth: false }), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    const sent = fetchMock.mock.calls[0]![1]! as RequestInit
    const h = new Headers(sent.headers as HeadersInit)
    expect(h.get("x-api-key")).toBe("vaulted-provider-key")
    expect(h.get("x-sanction-key")).toBeNull() // sanction auth still never leaks upstream
  })

  it("caller-supplied auth wins — vault is not consulted", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as never
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })
})
