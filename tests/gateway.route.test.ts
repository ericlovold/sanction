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
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))
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

import { POST as gateway, maxDuration } from "../app/api/gateway/[provider]/[...path]/route"
import { isBudgetExhausted } from "../lib/gateway"
import { reserveGatewayBudget, resolveGatewayBudget, releaseGatewayBudget, recordGatewayBudgetDenial, GatewayWalletFrozenError, GATEWAY_HOLD_LIFETIME_MS } from "../lib/gatewayBudget"

vi.mock("@/lib/gatewayBudget", async (orig) => ({
  ...await orig<typeof import("@/lib/gatewayBudget")>(),
  recordGatewayBudgetDenial: vi.fn(async () => "denial_1"),
  reserveGatewayBudget: vi.fn(async () => ({ exhausted: false, spent: 1, budget: 10, reservationId: "hold_1" })),
  resolveGatewayBudget: vi.fn(async () => 0.05),
  releaseGatewayBudget: vi.fn(async () => {}),
}))
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

function req(provider: string, path: string, opts: { key?: string | null; body?: unknown; providerAuth?: boolean; method?: "POST" | "GET" } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.providerAuth !== false) headers["authorization"] = "Bearer caller-own-key"
  if (opts.key !== null) headers["x-sanction-key"] = opts.key ?? KEY
  return new NextRequest(`https://test.local/api/gateway/${provider}/${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.method === "GET" ? undefined : JSON.stringify(opts.body ?? { model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }),
  })
}
const params = (provider: string, path: string) => ({ params: Promise.resolve({ provider, path: path.split("/") }) })

beforeEach(() => {
  dbMock.wallet.findUnique.mockResolvedValue({ id: "w_root", parentId: null, frozenAt: null, frozenReason: null }) // KILL-1: routes now read freeze state
  vi.clearAllMocks()
  vi.mocked(resolveGatewayBudget).mockResolvedValue(0.05)
  vi.mocked(reserveGatewayBudget).mockResolvedValue({ exhausted: false, spent: 1, budget: 10, reservationId: "hold_1" })
  vi.mocked(releaseGatewayBudget).mockResolvedValue(undefined)
  vi.mocked(recordGatewayBudgetDenial).mockResolvedValue("denial_1")
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: false, spent: 1, budget: 10 } as never)
})

afterEach(() => {
  global.fetch = realFetch
})

describe("gateway hold lifetime", () => {
  it("outlasts the longest call the route can run, with settlement retries inside it", () => {
    // A hold stops occupying capacity once this lifetime passes, so it must
    // never end while the call it covers can still be streaming or settling.
    expect(GATEWAY_HOLD_LIFETIME_MS).toBeGreaterThanOrEqual(maxDuration * 1000 * 3)
  })
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
    vi.mocked(reserveGatewayBudget).mockResolvedValue({ exhausted: true, spent: 10, budget: 10, horizon: "daily" } as never)
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
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 100, tokensOut: 50 }), true)

    // response passthrough: body intact, no-store stamped
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).id).toBe("msg_1")
  })

  it("passes through a JSON response with no usage block unmetered", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as never
    const res = await gateway(req("openai", "v1/models", { method: "GET" }), params("openai", "v1/models"))
    expect(res.status).toBe(200)
    expect(resolveGatewayBudget).not.toHaveBeenCalled()
  })

  it("withholds JSON responses when observed usage cannot be metered", async () => {
    const upstreamBody = JSON.stringify({ id: "msg_1", usage: { input_tokens: 100, output_tokens: 50 }, model: "claude-sonnet-5" })
    global.fetch = vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } })) as never
    vi.mocked(resolveGatewayBudget).mockRejectedValueOnce(new Error("db down"))

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
    expect(resolveGatewayBudget).toHaveBeenCalled()
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
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 80, tokensOut: 40 }), true)
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
    vi.mocked(resolveGatewayBudget).mockRejectedValueOnce(new Error("transient blip")) // first attempt fails, retry succeeds

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SSE_WITH_USAGE)
    expect(resolveGatewayBudget).toHaveBeenCalledTimes(2) // failed once, retried, succeeded
  })

  it("retains the reservation if SSE settlement fails after bounded retries", async () => {
    global.fetch = vi.fn(async () =>
      new Response(new Blob([SSE_WITH_USAGE]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as never
    vi.mocked(resolveGatewayBudget).mockRejectedValue(new Error("db down")) // every attempt fails

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    // The client already received the bytes; we can't withhold a live stream.
    // The budget gate fails closed on a DB outage BEFORE the provider call, so
    // a stream that got this far means the read succeeded — the write blip is
    // the committed hold stays charged; this cannot reopen capacity.
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SSE_WITH_USAGE)
    expect(resolveGatewayBudget).toHaveBeenCalledTimes(3) // bounded retries
    expect(releaseGatewayBudget).not.toHaveBeenCalled()
  })
})

describe("gateway proxy — abandoned streams and header hygiene", () => {
  const MESSAGE_START = 'data: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":80,"output_tokens":1}}}\n\n'

  beforeEach(() => {
    // An earlier test leaves meterUsage rejecting; clearAllMocks keeps implementations.
    vi.mocked(resolveGatewayBudget).mockResolvedValue(0.05)
  })

  // An upstream that emits message_start and then hangs, like a long generation.
  function hangingSse(onCancel?: () => void) {
    return new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(MESSAGE_START))
      },
      cancel() {
        onCancel?.()
      },
    })
  }

  it("meters accumulated usage once when the client abandons the stream, and cancels upstream", async () => {
    let upstreamCancelled = false
    global.fetch = vi.fn(async () =>
      new Response(hangingSse(() => { upstreamCancelled = true }), { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as never

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    const reader = res.body!.getReader()
    await reader.read() // message_start reaches the client
    await reader.cancel("client went away")

    expect(resolveGatewayBudget).toHaveBeenCalledTimes(1)
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 80 }), false)
    expect(upstreamCancelled).toBe(true)
  })

  it("meters accumulated usage once when the upstream stream errors mid-flight", async () => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c
        c.enqueue(new TextEncoder().encode(MESSAGE_START))
      },
    })
    global.fetch = vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { "content-type": "text/event-stream" } })) as never

    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    const reader = res.body!.getReader()
    await reader.read()
    ctl.error(new Error("upstream reset"))
    await expect(reader.read()).rejects.toThrow("upstream reset")

    expect(resolveGatewayBudget).toHaveBeenCalledTimes(1)
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 80 }), false)
  })

  it("never forwards cookies, management keys or proxy/platform headers upstream, and drops upstream set-cookie", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "tracker=1", "x-request-id": "req_1" },
      }),
    )
    global.fetch = fetchMock as never
    const r = new NextRequest("https://test.local/api/gateway/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "caller-own-anthropic-key",
        "x-sanction-key": KEY,
        cookie: "sanction_session=secret",
        "x-mgmt-key": "sk_owner",
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-host": "getsanction.com",
        "x-vercel-id": "iad1::abc",
        "x-vercel-proxy-signature": "sig",
        "x-real-ip": "203.0.113.9",
        forwarded: "for=203.0.113.9",
      },
      body: JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }),
    })
    const res = await gateway(r, params("anthropic", "v1/messages"))

    const sent = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    for (const h of ["cookie", "x-mgmt-key", "x-sanction-key", "x-forwarded-for", "x-forwarded-host", "x-vercel-id", "x-vercel-proxy-signature", "x-real-ip", "forwarded"]) {
      expect(sent.get(h), h).toBeNull()
    }
    // the caller's own provider key is its upstream auth and must still go through
    expect(sent.get("x-api-key")).toBe("caller-own-anthropic-key")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(res.headers.get("x-request-id")).toBe("req_1")
  })

  it("404s provider names that only exist on Object.prototype", async () => {
    global.fetch = vi.fn()
    for (const p of ["constructor", "toString", "__proto__"]) {
      const res = await gateway(req(p, "v1/messages"), params(p, "v1/messages"))
      expect(res.status, p).toBe(404)
    }
    expect(global.fetch).not.toHaveBeenCalled()
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
    const sent = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const h = new Headers(sent.headers as HeadersInit)
    expect(h.get("x-api-key")).toBe("vaulted-provider-key")
    expect(h.get("x-sanction-key")).toBeNull() // sanction auth still never leaks upstream
  })

  it("403s GATEWAY_PATH_NOT_METERED when the stored key would go to an unmetered endpoint, without calling upstream", async () => {
    global.fetch = vi.fn() as never
    const res = await gateway(req("anthropic", "v1/messages/batches", { providerAuth: false }), params("anthropic", "v1/messages/batches"))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("GATEWAY_PATH_NOT_METERED")
    expect(global.fetch).not.toHaveBeenCalled()
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("403s when the stored key would fund an OpenAI background-mode response, without calling upstream", async () => {
    global.fetch = vi.fn() as never
    const res = await gateway(
      req("openai", "v1/responses", { providerAuth: false, body: { model: "gpt-5", input: "hi", background: true } }),
      params("openai", "v1/responses"),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("GATEWAY_PATH_NOT_METERED")
    expect(body.error).toContain("background")
    expect(global.fetch).not.toHaveBeenCalled()
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("forwards a stored-key OpenAI responses call with background: false", async () => {
    dbMock.credentialVault.findFirst.mockResolvedValueOnce({ id: "cred_1", walletId: "wallet_1", label: "provider:openai", encryptedValue: "x", keyId: "k" })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as never
    const res = await gateway(
      req("openai", "v1/responses", { providerAuth: false, body: { model: "gpt-5", input: "hi", background: false } }),
      params("openai", "v1/responses"),
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects background generation even with caller-owned auth because its cost cannot be reserved", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as never
    const res = await gateway(
      req("openai", "v1/responses", { body: { model: "gpt-5", input: "hi", background: true } }),
      params("openai", "v1/responses"),
    )
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("rejects caller-key POSTs to unmetered endpoints before dispatch", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as never
    const res = await gateway(req("openai", "v1/files"), params("openai", "v1/files"))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("caller-supplied auth wins — vault is not consulted", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as never
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })
})

describe("gateway reservation lifecycle", () => {
  it("commits the hold before fetch and forwards the enforced output cap", async () => {
    let held = false
    vi.mocked(reserveGatewayBudget).mockImplementationOnce(async () => {
      await Promise.resolve()
      held = true
      return { exhausted: false, spent: 0, budget: 10, reservationId: "hold_1" }
    })
    global.fetch = vi.fn(async (_url, init) => {
      expect(held).toBe(true)
      const sent = JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))
      expect(sent.max_tokens).toBe(1024)
      return Response.json({ model: "claude-sonnet-5", usage: { input_tokens: 3, output_tokens: 4 } })
    })
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(reserveGatewayBudget).toHaveBeenCalledWith(AGENT, expect.objectContaining({ reservedUsd: expect.any(Number) }))
  })

  it("402s an oversubscribed shared cap without calling the provider", async () => {
    vi.mocked(reserveGatewayBudget).mockResolvedValueOnce({ exhausted: true, spent: 5, budget: 5, horizon: "subtree-daily", capWalletId: "root" })
    global.fetch = vi.fn()
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: "GATEWAY_BUDGET_EXCEEDED", cap_wallet_id: "root", requested_reservation_usd: expect.any(Number) })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("fails closed on a reservation write failure", async () => {
    vi.mocked(reserveGatewayBudget).mockRejectedValueOnce(new Error("db down"))
    global.fetch = vi.fn()
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 422, 429])("releases a definitively rejected %s request", async (status) => {
    global.fetch = vi.fn(async () => Response.json({ error: "rejected" }, { status }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(status)
    expect(releaseGatewayBudget).toHaveBeenCalledWith("hold_1")
    expect(resolveGatewayBudget).not.toHaveBeenCalled()
  })

  it.each([408, 500, 502, 503, 529])("retains a hold after an ambiguous %s response", async (status) => {
    global.fetch = vi.fn(async () => Response.json({ error: "unknown outcome" }, { status }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(status)
    expect(releaseGatewayBudget).not.toHaveBeenCalled()
    expect(resolveGatewayBudget).not.toHaveBeenCalled()
  })

  it("retains a hold after a network failure or success without usage", async () => {
    global.fetch = vi.fn(async () => { throw new Error("socket reset after dispatch") })
    expect((await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))).status).toBe(502)
    global.fetch = vi.fn(async () => Response.json({ id: "no-usage" }))
    expect((await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))).status).toBe(200)
    expect(releaseGatewayBudget).not.toHaveBeenCalled()
    expect(resolveGatewayBudget).not.toHaveBeenCalled()
  })

  it("treats truncated JSON usage as partial, never releasing unused capacity", async () => {
    global.fetch = vi.fn(async () => Response.json({ model: "claude-sonnet-5", usage: { input_tokens: 10 } }))
    await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 10 }), false)
  })

  it("settles reported zero usage instead of abandoning its reservation", async () => {
    global.fetch = vi.fn(async () => Response.json({ model: "claude-sonnet-5", usage: { input_tokens: 0, output_tokens: 0 } }))
    await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 0, tokensOut: 0 }), true)
  })

  it("reads a terminal SSE event without a trailing newline", async () => {
    const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\ndata: {"type":"message_stop"}'
    global.fetch = vi.fn(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(await res.text()).toBe(sse)
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), true)
  })

  it("retains capacity when an SSE stream closes before its terminal event", async () => {
    const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n'
    global.fetch = vi.fn(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    await res.text()
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3 }), false)
  })
})

describe("gateway final usage evidence", () => {
  it("reserves streamed Responses without injecting a Chat-Completions-only field", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))
      expect(body.stream_options).toBeUndefined()
      expect(body.max_output_tokens).toBe(1024)
      return new Response('data: {"type":"response.completed","response":{"model":"gpt-4o","usage":{"input_tokens":3,"output_tokens":4}}}\n\n', { headers: { "content-type": "text/event-stream" } })
    })
    const res = await gateway(req("openai", "v1/responses", { body: { model: "gpt-4o", input: "hi", stream: true } }), params("openai", "v1/responses"))
    expect(res.status).toBe(200)
    await res.text()
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), true)
  })

  it("does not release a rejection that carries usage", async () => {
    global.fetch = vi.fn(async () => Response.json({ usage: { input_tokens: 3, output_tokens: 4 } }, { status: 429 }))
    await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(releaseGatewayBudget).not.toHaveBeenCalled()
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), false)
  })

  it("does not treat a terminal marker after an error event as complete usage", async () => {
    global.fetch = vi.fn(async () => new Response([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":4}}',
      'data: {"type":"error","error":{"message":"failed"}}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { headers: { "content-type": "text/event-stream" } }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    await res.text()
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), false)
  })
})

it("settles text embeddings with their actual prompt-only usage shape", async () => {
  global.fetch = vi.fn(async () => Response.json({
    model: "text-embedding-3-small", data: [{ embedding: [0.1] }], usage: { prompt_tokens: 3, total_tokens: 3 },
  }))
  const res = await gateway(req("openai", "v1/embeddings", { body: { model: "text-embedding-3-small", input: "hello" } }), params("openai", "v1/embeddings"))
  expect(res.status).toBe(200)
  expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 0 }), true)
})

it("does not bill response retrieval again or create an unreserved usage write", async () => {
  global.fetch = vi.fn(async () => Response.json({ model: "gpt-4o", usage: { input_tokens: 100, output_tokens: 200 } }))
  const res = await gateway(req("openai", "v1/responses/response_1", { method: "GET" }), params("openai", "v1/responses/response_1"))
  expect(res.status).toBe(200)
  expect(reserveGatewayBudget).not.toHaveBeenCalled()
  expect(resolveGatewayBudget).not.toHaveBeenCalled()
})

describe("gateway review regressions", () => {
  it("lets the reservation decide generation admission despite stale legacy attribution", async () => {
    vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: true, spent: 10, budget: 10, horizon: "subtree-daily" })
    global.fetch = vi.fn(async () => Response.json({ usage: { input_tokens: 3, output_tokens: 4 } }))
    const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
    expect(res.status).toBe(200)
    expect(isBudgetExhausted).not.toHaveBeenCalled()
    expect(reserveGatewayBudget).toHaveBeenCalledOnce()
  })

  it.each(["oversize", "invalid-utf8"])("rejects %s original streamed bytes before rewriting or dispatch", async (kind) => {
    const prefix = new TextEncoder().encode('{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"')
    const suffix = new TextEncoder().encode('"}]}')
    const raw = kind === "oversize"
      ? new TextEncoder().encode(' '.repeat(8 * 1024 * 1024) + '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}')
      : new Uint8Array([...prefix, 0xff, ...suffix])
    const request = new NextRequest("https://test.local/api/gateway/openai/v1/chat/completions", {
      method: "POST", headers: { "x-sanction-key": KEY, authorization: "Bearer provider-key" }, body: raw,
    })
    global.fetch = vi.fn()
    const res = await gateway(request, params("openai", "v1/chat/completions"))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "GATEWAY_RESERVATION_INVALID_REQUEST" })
    expect(reserveGatewayBudget).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([false, true])("retains a hold after malformed SSE data (malformed=%s)", async (malformed) => {
    const sse = ['data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}',
      ...(malformed ? ['data: {broken json'] : []), 'data: [DONE]', ''].join('\n\n')
    global.fetch = vi.fn(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }))
    const res = await gateway(req("openai", "v1/chat/completions", { body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true } }), params("openai", "v1/chat/completions"))
    expect(await res.text()).toBe(sse)
    expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), !malformed)
    expect(releaseGatewayBudget).not.toHaveBeenCalled()
  })

  it("retains a hold when cancellation resolves a pending read after terminal usage", async () => {
    const upstream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n'))
    } })
    global.fetch = vi.fn(async () => new Response(upstream, { headers: { "content-type": "text/event-stream" } }))
    const res = await gateway(req("openai", "v1/chat/completions", { body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true } }), params("openai", "v1/chat/completions"))
    const reader = res.body!.getReader()
    await reader.read()
    const pending = reader.read()
    await reader.cancel("cancel with read pending")
    expect(await pending).toMatchObject({ done: true })
    expect(resolveGatewayBudget).toHaveBeenCalledExactlyOnceWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), false)
  })

  const cases = [
    { label: "normal", usage: { promptTokenCount: 3, candidatesTokenCount: 4 }, complete: true, out: 4 },
    { label: "thinking", usage: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 10 }, complete: true, out: 14 },
    { label: "invalid thoughts", usage: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: -1 }, complete: false, out: 3 },
    { label: "thinking only with total", usage: { promptTokenCount: 3, thoughtsTokenCount: 10, totalTokenCount: 13 }, complete: true, out: 10 },
    { label: "omitted candidates included in total", usage: { promptTokenCount: 3, thoughtsTokenCount: 10, totalTokenCount: 17 }, complete: true, out: 14 },
    { label: "missing candidate evidence", usage: { promptTokenCount: 3, thoughtsTokenCount: 10 }, complete: false, out: 10 },
    { label: "inconsistent total", usage: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 8 }, complete: false, out: 4 },
    { label: "unaccounted tool prompt", usage: { promptTokenCount: 3, candidatesTokenCount: 4, toolUsePromptTokenCount: 2 }, complete: false, out: 4 },
  ]
  describe.each([false, true])("Gemini stream=%s", (stream) => {
    it.each(cases)("settles $label according to complete usage evidence", async ({ usage, complete, out }) => {
      const response = { usageMetadata: usage, candidates: [{ finishReason: "MAX_TOKENS" }] }
      global.fetch = vi.fn(async () => stream
        ? new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { "content-type": "text/event-stream" } })
        : Response.json(response))
      const path = `v1beta/models/gemini-2.5-flash:${stream ? "streamGenerateContent" : "generateContent"}`
      const res = await gateway(req("gemini", path, { body: { contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 10 } } } }), params("gemini", path))
      expect(res.status).toBe(200)
      await res.text()
      expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: out }), complete)
    })
  })
})

it("returns the typed freeze denial when the wallet freezes during reservation", async () => {
  vi.mocked(reserveGatewayBudget).mockRejectedValueOnce(new GatewayWalletFrozenError({ frozen: true, frozenWalletId: "wallet_1", self: true, reason: null }))
  global.fetch = vi.fn()
  const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
  expect(res.status).toBe(403)
  expect(res.headers.get("cache-control")).toBe("no-store")
  expect(await res.json()).toMatchObject({ code: "WALLET_FROZEN" })
  expect(global.fetch).not.toHaveBeenCalled()
})

it("records a legacy non-generating budget denial before returning 402", async () => {
  vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: true, spent: 10, budget: 10, horizon: "daily" })
  global.fetch = vi.fn()
  const res = await gateway(req("openai", "v1/models", { method: "GET" }), params("openai", "v1/models"))
  expect(res.status).toBe(402)
  expect(await res.json()).toMatchObject({ request_id: "denial_1", horizon: "daily" })
  expect(recordGatewayBudgetDenial).toHaveBeenCalledWith(AGENT, expect.objectContaining({ provider: "openai", path: "v1/models", verdict: expect.objectContaining({ exhausted: true }) }))
  expect(global.fetch).not.toHaveBeenCalled()
})

it("fails closed when a legacy budget denial cannot be recorded", async () => {
  vi.mocked(isBudgetExhausted).mockResolvedValue({ exhausted: true, spent: 10, budget: 10, horizon: "daily" })
  vi.mocked(recordGatewayBudgetDenial).mockRejectedValueOnce(new Error("db down"))
  global.fetch = vi.fn()
  const res = await gateway(req("openai", "v1/models", { method: "GET" }), params("openai", "v1/models"))
  expect(res.status).toBe(503)
  expect(global.fetch).not.toHaveBeenCalled()
})

it.each([200, 400])("retains the hold for invalid UTF-8 JSON on status %s", async (status) => {
  const raw = new Uint8Array([
    ...new TextEncoder().encode('{"message":"'), 0xff,
    ...new TextEncoder().encode(status === 200 ? '","usage":{"input_tokens":3,"output_tokens":4}}' : '"}'),
  ])
  global.fetch = vi.fn(async () => new Response(raw, { status, headers: { "content-type": "application/json" } }))
  const res = await gateway(req("anthropic", "v1/messages"), params("anthropic", "v1/messages"))
  expect(res.status).toBe(status)
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(raw)
  expect(releaseGatewayBudget).not.toHaveBeenCalled()
  expect(resolveGatewayBudget).not.toHaveBeenCalled()
})

it.each([{ error: { message: "stream failed" } }, null, "invalid chunk"])("retains a Gemini array hold after a failed or malformed trailing chunk: %j", async (tail) => {
  global.fetch = vi.fn(async () => Response.json([
    { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 }, candidates: [{ finishReason: "STOP" }] }, tail,
  ]))
  const path = "v1beta/models/gemini-2.5-flash:streamGenerateContent"
  const res = await gateway(req("gemini", path, { body: { contents: [{ parts: [{ text: "hi" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } }), params("gemini", path))
  expect(res.status).toBe(200)
  expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), false)
  expect(releaseGatewayBudget).not.toHaveBeenCalled()
})

it("settles a successful Responses result with its normal null error field", async () => {
  global.fetch = vi.fn(async () => Response.json({ status: "completed", error: null, usage: { input_tokens: 3, output_tokens: 4 } }))
  const res = await gateway(req("openai", "v1/responses", { body: { model: "gpt-4o", input: "hi" } }), params("openai", "v1/responses"))
  expect(res.status).toBe(200)
  expect(resolveGatewayBudget).toHaveBeenCalledWith("hold_1", expect.objectContaining({ tokensIn: 3, tokensOut: 4 }), true)
})
