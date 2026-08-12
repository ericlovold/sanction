import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { issueExecutionJWT } from "../lib/jwt"

const { dbMock, rateLimitMock, freezeMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    executionToken: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  rateLimitMock: vi.fn(),
  freezeMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})
vi.mock("@/lib/freeze", async (orig) => {
  const mod = await orig<typeof import("@/lib/freeze")>()
  return { ...mod, walletFreezeState: freezeMock }
})
vi.mock("@/lib/rls", () => ({
  withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock),
}))

import { POST as verifyMandate } from "../app/api/v1/mandate/verify/route"

const WID = "wallet_1"
const AID = "agent_1"

function req(body: unknown) {
  return new NextRequest("https://test.local/api/v1/mandate/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitMock.mockResolvedValue({ ok: true, limit: 60 })
  freezeMock.mockResolvedValue({ frozen: false })
})

describe("POST /v1/mandate/verify — WALLET-1", () => {
  it("429s when the IP is over the public rate limit", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 12, limit: 60 })
    const res = await verifyMandate(req({ mandate: "x" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("12")
  })

  it("400 without a mandate field", async () => {
    expect((await verifyMandate(req({}))).status).toBe(400)
  })

  it("400 on invalid JSON", async () => {
    const bad = new NextRequest("https://test.local/api/v1/mandate/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })
    expect((await verifyMandate(bad)).status).toBe(400)
  })

  it("returns invalid (not 401) for garbage — counterparties fail closed on the body", async () => {
    const res = await verifyMandate(req({ mandate: "not-a-jwt" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      valid: false,
      status: "invalid",
      reason: "Unknown or unverifiable mandate",
    })
    expect(dbMock.executionToken.findUnique).not.toHaveBeenCalled()
  })

  it("returns active remaining budget for a live, unfrozen mandate", async () => {
    const { jwt, jti } = await issueExecutionJWT({
      wallet: WID,
      agent: AID,
      clearance: 2,
      scope: ["openai"],
      budget_usd: 10,
    })
    const expiresAt = new Date(Date.now() + 60_000)
    const issuedAt = new Date()
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti,
      walletId: WID,
      agentId: AID,
      status: "active",
      revokedAt: null,
      expiresAt,
      issuedAt,
      spentUsd: 1.5,
      budgetUsd: 10,
      scope: ["openai"],
      clearance: 2,
    })

    const res = await verifyMandate(req({ mandate: jwt }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      valid: true,
      status: "active",
      wallet_id: WID,
      agent_id: AID,
      remaining_usd: 8.5,
      scope: ["openai"],
    })
    expect(JSON.stringify(body)).not.toMatch(/eyJ/)
  })

  it("returns frozen when KILL-1 is on, even if the JWT is unexpired", async () => {
    const { jwt, jti } = await issueExecutionJWT({
      wallet: WID,
      agent: AID,
      clearance: 1,
      scope: ["openai"],
      budget_usd: 5,
    })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti,
      walletId: WID,
      agentId: AID,
      status: "active",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      spentUsd: 0,
      budgetUsd: 5,
      scope: ["openai"],
      clearance: 1,
    })
    freezeMock.mockResolvedValue({ frozen: true, frozenWalletId: WID, self: true, reason: "pause" })

    const body = await (await verifyMandate(req({ mandate: jwt }))).json()
    expect(body).toMatchObject({ valid: false, status: "frozen" })
  })

  it("returns invalid when the row's wallet does not match the signed claims", async () => {
    const { jwt, jti } = await issueExecutionJWT({
      wallet: WID,
      agent: AID,
      clearance: 1,
      scope: ["openai"],
      budget_usd: 5,
    })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti,
      walletId: "wallet_other",
      agentId: AID,
      status: "active",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      spentUsd: 0,
      budgetUsd: 5,
      scope: ["openai"],
      clearance: 1,
    })

    const body = await (await verifyMandate(req({ mandate: jwt }))).json()
    expect(body.status).toBe("invalid")
    expect(body.wallet_id).toBeUndefined()
  })
})
