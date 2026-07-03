import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Route tests for GET /v1/reporting/daily-summary — the one-day rollup. Verifies
// the membership gate, date validation/default, and the aggregated shape.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), groupBy: vi.fn() },
    tokenLog: { aggregate: vi.fn(), groupBy: vi.fn() },
    credentialInjection: { count: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

const { authMock } = vi.hoisted(() => ({
  authMock: { authenticateOwner: vi.fn(), authenticateAgent: vi.fn() },
}))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: authMock.authenticateOwner }))
vi.mock("@/lib/auth", () => ({ authenticateAgent: authMock.authenticateAgent }))

import { GET as dailySummary } from "../app/api/v1/reporting/daily-summary/route"

const WID = "wallet_1"

function req(qs: string) {
  return new NextRequest(`https://test.local/api/v1/reporting/daily-summary${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.authenticateOwner.mockResolvedValue({ wallet: { id: WID } })
  authMock.authenticateAgent.mockResolvedValue({ agent: null })
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1" }])
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 42.5 } })
  dbMock.authorizationRequest.groupBy.mockResolvedValue([
    { status: "approved", _count: { _all: 7 } },
    { status: "denied", _count: { _all: 2 } },
  ])
  dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 1.25, tokensIn: 1000, tokensOut: 500 } })
  dbMock.credentialInjection.count.mockResolvedValue(3)
  dbMock.tokenLog.groupBy.mockResolvedValue([
    { taskLabel: "backlog #42", _sum: { costUsd: 0.9 } },
    { taskLabel: null, _sum: { costUsd: 0.35 } },
  ])
})

describe("GET /reporting/daily-summary — auth gate", () => {
  it("400 without wallet_id", async () => {
    expect((await dailySummary(req(""))).status).toBe(400)
  })

  it("401 when neither owner nor a wallet agent authenticates", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: null })
    expect((await dailySummary(req(`?wallet_id=${WID}`))).status).toBe(401)
  })

  it("401 when the agent belongs to a different wallet", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: { walletId: "other" } })
    expect((await dailySummary(req(`?wallet_id=${WID}`))).status).toBe(401)
  })

  it("allows a wallet agent when owner auth fails", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: { walletId: WID } })
    expect((await dailySummary(req(`?wallet_id=${WID}`))).status).toBe(200)
  })
})

describe("GET /reporting/daily-summary — rollup", () => {
  it("returns the aggregated day shape", async () => {
    const res = await dailySummary(req(`?wallet_id=${WID}&date=2026-06-17`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      wallet_id: WID,
      date: "2026-06-17",
      spend_usd: 42.5,
      token_cost_usd: 1.25,
      tokens_in: 1000,
      tokens_out: 500,
      secret_accesses: 3,
    })
    // Decision counts fill in zeroes for statuses with no rows.
    expect(body.decisions).toEqual({ approved: 7, denied: 2, escalated: 0, pending: 0 })
    // Untagged token logs surface as "(untagged)".
    expect(body.most_expensive_tasks).toEqual([
      { task_label: "backlog #42", cost_usd: 0.9 },
      { task_label: "(untagged)", cost_usd: 0.35 },
    ])
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("400 on a malformed date", async () => {
    expect((await dailySummary(req(`?wallet_id=${WID}&date=2026-6-1`))).status).toBe(400)
  })

  it("defaults to today (YYYY-MM-DD) when no date is given", async () => {
    const res = await dailySummary(req(`?wallet_id=${WID}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
