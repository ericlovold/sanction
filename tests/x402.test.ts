import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { hashApiKey } from "../lib/apiKey"
import {
  parseX402Challenge,
  priceChallenge,
  quoteMerchant,
  quoteSettlement,
} from "../lib/x402"
import { gateX402Response, type SpendAuthorizer } from "../lib/x402Gate"

// STABLE-1: the x402 spend gate. The pure half prices a challenge (or refuses
// to); the gate half turns that into an allow/refuse where a refusal WITHHOLDS
// the challenge — the enforcement claim.

// Native USDC on Base (Circle, 6 decimals) — the one asset the v1 registry prices.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

const accept = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000", // 10000 / 1e6 = $0.01
  resource: "https://api.vendor.example/search",
  description: "Search query",
  payTo: "0xabc0000000000000000000000000000000000001",
  asset: USDC_BASE,
  ...over,
})

const challengeBody = (accepts: unknown[] = [accept()]) => ({
  x402Version: 1,
  error: "X-PAYMENT header is required",
  accepts,
})

describe("x402 challenge parsing", () => {
  it("recognizes a well-formed payment-required body", () => {
    const c = parseX402Challenge(challengeBody())
    expect(c?.version).toBe(1)
    expect(c?.accepts).toHaveLength(1)
  })

  it("rejects a body with no x402Version", () => {
    expect(parseX402Challenge({ accepts: [accept()] })).toBeNull()
  })

  it("rejects an empty or missing accepts list", () => {
    expect(parseX402Challenge({ x402Version: 1, accepts: [] })).toBeNull()
    expect(parseX402Challenge({ x402Version: 1 })).toBeNull()
  })

  it("rejects non-objects", () => {
    expect(parseX402Challenge(null)).toBeNull()
    expect(parseX402Challenge("402")).toBeNull()
  })
})

describe("x402 pricing — USD-pegged only, worst case wins", () => {
  it("prices native USDC on Base from atomic units", () => {
    const r = priceChallenge(parseX402Challenge(challengeBody())!)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote.amountUsd).toBe(0.01)
    expect(r.quote.amountAtomic).toBe("10000")
    expect(r.quote.network).toBe("base")
  })

  it("is case-insensitive on the asset address", () => {
    const r = priceChallenge(parseX402Challenge(challengeBody([accept({ asset: USDC_BASE.toLowerCase() })]))!)
    expect(r.ok).toBe(true)
  })

  it("authorizes the MOST expensive option — the client picks, we cannot know which", () => {
    const r = priceChallenge(
      parseX402Challenge(challengeBody([accept({ maxAmountRequired: "10000" }), accept({ maxAmountRequired: "2500000" })]))!,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote.amountUsd).toBe(2.5) // 2_500_000 atomic / 1e6 decimals
  })

  it("refuses the WHOLE challenge when any single option is unpriceable", () => {
    const r = priceChallenge(
      parseX402Challenge(challengeBody([accept(), accept({ asset: "0xdeadbeef00000000000000000000000000000000" })]))!,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe("QUOTE_NOT_PRICEABLE")
  })

  it("refuses an unknown network even with a known asset address", () => {
    const r = priceChallenge(parseX402Challenge(challengeBody([accept({ network: "fantom" })]))!)
    expect(r.ok).toBe(false)
  })

  it("refuses a non-integer atomic amount rather than coercing it", () => {
    const r = priceChallenge(parseX402Challenge(challengeBody([accept({ maxAmountRequired: "0.05" })]))!)
    expect(r.ok).toBe(false)
  })

  it("refuses when required fields are missing", () => {
    const r = priceChallenge(parseX402Challenge(challengeBody([accept({ payTo: undefined })]))!)
    expect(r.ok).toBe(false)
  })

  it("charges the resource host as the merchant, falling back to the payee", () => {
    const priced = priceChallenge(parseX402Challenge(challengeBody())!)
    if (!priced.ok) throw new Error("expected priceable")
    expect(quoteMerchant(priced.quote)).toBe("api.vendor.example")
    expect(quoteMerchant({ ...priced.quote, resource: undefined })).toBe(priced.quote.payTo)
    expect(quoteMerchant({ ...priced.quote, resource: "/bare/path" })).toBe(priced.quote.payTo)
  })

  it("derives STABLE-0 settlement metadata from the quote", () => {
    const priced = priceChallenge(parseX402Challenge(challengeBody())!)
    if (!priced.ok) throw new Error("expected priceable")
    expect(quoteSettlement(priced.quote)).toEqual({ rail: "x402", asset: "usdc", network: "base" })
  })
})

describe("the gate — a refusal withholds the challenge", () => {
  const res402 = (body: unknown) => new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json" } })

  it("passes through a 402 that is not an x402 challenge", async () => {
    const authorize = vi.fn()
    const v = await gateX402Response(res402({ error: "pay up" }), authorize as unknown as SpendAuthorizer)
    expect(v.effect).toBe("pass")
    expect(authorize).not.toHaveBeenCalled()
  })

  it("passes through a non-JSON 402 body", async () => {
    const authorize = vi.fn()
    const v = await gateX402Response(new Response("Payment Required", { status: 402 }), authorize as unknown as SpendAuthorizer)
    expect(v.effect).toBe("pass")
    expect(authorize).not.toHaveBeenCalled()
  })

  it("refuses an unpriceable quote WITHOUT consulting the ladder", async () => {
    const authorize = vi.fn()
    const v = await gateX402Response(
      res402(challengeBody([accept({ asset: "0xdeadbeef00000000000000000000000000000000" })])),
      authorize as unknown as SpendAuthorizer,
    )
    expect(v.effect).toBe("refuse")
    if (v.effect !== "refuse") return
    expect(v.code).toBe("QUOTE_NOT_PRICEABLE")
    expect(authorize).not.toHaveBeenCalled()
  })

  it("authorizes the priced quote as spend, with settlement metadata attached", async () => {
    const authorize = vi.fn(async () => ({ authorized: true, status: "approved", request_id: "req_1", httpStatus: 200 }))
    const v = await gateX402Response(res402(challengeBody()), authorize)
    expect(v.effect).toBe("allow")
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 0.01,
        merchant: "api.vendor.example",
        settlement: { rail: "x402", asset: "usdc", network: "base" },
      }),
    )
    if (v.effect !== "allow") return
    expect(v.requestId).toBe("req_1")
    // Approved: the challenge is handed back so the agent's own wallet signs it.
    expect(JSON.parse(v.rawBody).accepts).toHaveLength(1)
  })

  it("on a denial returns NO challenge body — the agent cannot sign what it never receives", async () => {
    const authorize = vi.fn(async () => ({
      authorized: false,
      status: "denied",
      code: "DAILY_BUDGET_EXCEEDED",
      reason: "Daily spend budget exceeded",
      httpStatus: 403,
    }))
    const v = await gateX402Response(res402(challengeBody()), authorize)
    expect(v.effect).toBe("refuse")
    if (v.effect !== "refuse") return
    expect(v.code).toBe("DAILY_BUDGET_EXCEEDED")
    // The verdict structurally cannot carry the payment requirements.
    expect(JSON.stringify(v)).not.toContain("payTo")
    expect(JSON.stringify(v)).not.toContain("maxAmountRequired")
  })

  it("carries an escalation's request_id so the agent can wait for a human", async () => {
    const authorize = vi.fn(async () => ({
      authorized: false,
      status: "escalated",
      code: "ESCALATION_REQUIRED",
      reason: "Exceeds escalation threshold",
      request_id: "req_esc",
      httpStatus: 200,
    }))
    const v = await gateX402Response(res402(challengeBody()), authorize)
    expect(v.effect).toBe("refuse")
    if (v.effect !== "refuse") return
    expect(v.status).toBe("escalated")
    expect(v.requestId).toBe("req_esc")
  })
})

// ── The cooperative half: POST /v1/authorize/quote ────────────────────────────
const { dbMock, spendMock } = vi.hoisted(() => ({
  dbMock: { agent: { findUnique: vi.fn(), update: vi.fn() } },
  spendMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// The spend ladder has its own suite; here we prove the quote route prices the
// challenge and hands the SAME shell a correctly-shaped spend request.
vi.mock("@/app/api/v1/authorize/route", () => ({ POST: spendMock }))

import { POST as authorizeQuote } from "../app/api/v1/authorize/quote/route"

const KEY = "pxy_testagentkey"
const AGENT = {
  id: "agent_1",
  walletId: "wallet_1",
  name: "researcher",
  isActive: true,
  lastUsedAt: new Date(),
  apiKeyHash: hashApiKey(KEY),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  wallet: { id: "wallet_1", ownerEmail: "owner@example.com", policy: { id: "pol_1", currentRevision: 1 } },
}

function quoteReq(body: unknown, opts: { key?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  return new NextRequest("https://test.local/api/v1/authorize/quote", { method: "POST", headers, body: JSON.stringify(body) })
}

describe("POST /v1/authorize/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.agent.findUnique.mockResolvedValue(AGENT)
    dbMock.agent.update.mockResolvedValue({})
    spendMock.mockResolvedValue(
      NextResponse.json({ authorized: true, status: "approved", request_id: "req_9", amount_usd: 0.01 }, { status: 200 }),
    )
  })

  it("401s without an agent key", async () => {
    expect((await authorizeQuote(quoteReq({ challenge: challengeBody() }, { key: null }))).status).toBe(401)
  })

  it("400s a challenge that is not x402", async () => {
    const res = await authorizeQuote(quoteReq({ challenge: { error: "pay" } }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("NOT_X402")
    expect(spendMock).not.toHaveBeenCalled()
  })

  it("403s an unpriceable quote before the ladder runs", async () => {
    const res = await authorizeQuote(
      quoteReq({ challenge: challengeBody([accept({ asset: "0xdeadbeef00000000000000000000000000000000" })]) }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("QUOTE_NOT_PRICEABLE")
    expect(spendMock).not.toHaveBeenCalled()
  })

  it("runs the priced quote through the spend ladder and echoes what was authorized", async () => {
    const res = await authorizeQuote(quoteReq({ challenge: challengeBody() }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authorized).toBe(true)
    expect(body.request_id).toBe("req_9")
    expect(body.quote).toMatchObject({ amount_usd: 0.01, network: "base", scheme: "exact" })
    expect(body.settlement).toEqual({ rail: "x402", asset: "usdc", network: "base" })

    // The in-process call carries the derived amount, merchant and settlement.
    const forwarded = JSON.parse(await spendMock.mock.calls[0][0].text())
    expect(forwarded).toMatchObject({
      action: "purchase",
      amount_usd: 0.01,
      merchant: "api.vendor.example",
      settlement: { rail: "x402", asset: "usdc", network: "base" },
    })
  })

  it("passes a grant_id through for the post-approval retry", async () => {
    await authorizeQuote(quoteReq({ challenge: challengeBody(), grant_id: "grant_1" }))
    const forwarded = JSON.parse(await spendMock.mock.calls[0][0].text())
    expect(forwarded.grant_id).toBe("grant_1")
  })
})
