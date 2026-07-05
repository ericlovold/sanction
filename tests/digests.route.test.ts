import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// REPORT-2: the weekly digest cron. Auth is the CRON_SECRET bearer (fail
// closed when unset), enumeration is opt-in (`report.weekly_digest` or "*"),
// and the rollup rides deliverEvent so Slack/machine routing is inherited.
const { dbMock, deliverMock } = vi.hoisted(() => ({
  dbMock: {
    webhook: { findMany: vi.fn() },
    agent: { findMany: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), groupBy: vi.fn() },
    tokenLog: { aggregate: vi.fn(), groupBy: vi.fn() },
    credentialInjection: { count: vi.fn() },
  },
  deliverMock: vi.fn(async (..._args: unknown[]) => {}),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/webhooks", () => ({ deliverEvent: deliverMock }))

import { GET as digests } from "../app/api/cron/digests/route"

function req(auth?: string) {
  const headers: Record<string, string> = {}
  if (auth) headers["authorization"] = auth
  return new NextRequest("https://test.local/api/cron/digests", { method: "GET", headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "cs_test"
  dbMock.webhook.findMany.mockResolvedValue([{ walletId: "w1" }])
  dbMock.agent.findMany.mockResolvedValue([{ id: "a1", name: "tenet" }])
  dbMock.authorizationRequest.aggregate
    .mockResolvedValueOnce({ _sum: { amountUsd: 120 } }) // this week
    .mockResolvedValueOnce({ _sum: { amountUsd: 80 } }) // last week
  dbMock.authorizationRequest.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by.includes("status")
      ? [
          { status: "approved", _count: { _all: 8 } },
          { status: "denied", _count: { _all: 3 } },
        ]
      : [{ agentId: "a1", _sum: { amountUsd: 120 } }],
  )
  dbMock.tokenLog.aggregate
    .mockResolvedValueOnce({ _sum: { costUsd: 4.2, tokensIn: 1000, tokensOut: 500 } })
    .mockResolvedValueOnce({ _sum: { costUsd: 2 } })
  dbMock.tokenLog.groupBy.mockResolvedValue([{ agentId: "a1", _sum: { costUsd: 4.2 } }])
  dbMock.credentialInjection.count.mockResolvedValue(2)
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe("GET /api/cron/digests — auth", () => {
  it("401s without the bearer, with a wrong bearer, and touches nothing", async () => {
    expect((await digests(req())).status).toBe(401)
    expect((await digests(req("Bearer wrong"))).status).toBe(401)
    expect(dbMock.webhook.findMany).not.toHaveBeenCalled()
    expect(deliverMock).not.toHaveBeenCalled()
  })

  it("fails closed when CRON_SECRET is unset — even a matching guess loses", async () => {
    delete process.env.CRON_SECRET
    expect((await digests(req("Bearer "))).status).toBe(401)
    expect((await digests(req("Bearer cs_test"))).status).toBe(401)
  })
})

describe("GET /api/cron/digests — rollup + delivery", () => {
  it("delivers last week's rollup with wk/wk comparison and busiest agent", async () => {
    const res = await digests(req("Bearer cs_test"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ wallets: 1, delivered: 1, failed: 0 })

    expect(deliverMock).toHaveBeenCalledTimes(1)
    const [walletId, event, data] = deliverMock.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(walletId).toBe("w1")
    expect(event).toBe("report.weekly_digest")
    expect(data).toMatchObject({
      spend_usd: 120,
      prev_spend_usd: 80,
      token_cost_usd: 4.2,
      prev_token_cost_usd: 2,
      tokens_in: 1000,
      tokens_out: 500,
      approved: 8,
      denied: 3,
      escalated: 0,
      secret_accesses: 2,
      top_agent: "tenet",
      top_agent_usd: 124.2,
    })
    // A 7-day window of completed UTC days, labeled inclusively.
    expect(data.period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(data.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const days = (Date.parse(`${data.period_end}T00:00:00Z`) - Date.parse(`${data.period_start}T00:00:00Z`)) / 86_400_000
    expect(days).toBe(6)
  })

  it("dedupes wallets across hooks and isolates one wallet's failure", async () => {
    dbMock.webhook.findMany.mockResolvedValue([{ walletId: "w1" }, { walletId: "w1" }, { walletId: "w2" }])
    dbMock.agent.findMany.mockRejectedValueOnce(new Error("db hiccup")) // w1's digest dies
    const res = await digests(req("Bearer cs_test"))
    expect(await res.json()).toEqual({ wallets: 2, delivered: 1, failed: 1 })
    expect(deliverMock).toHaveBeenCalledTimes(1)
    expect(deliverMock.mock.calls[0][0]).toBe("w2")
  })

  it("a wallet with no activity still gets a digest — all zeros is the report", async () => {
    dbMock.authorizationRequest.aggregate.mockReset().mockResolvedValue({ _sum: { amountUsd: null } })
    dbMock.authorizationRequest.groupBy.mockReset().mockResolvedValue([])
    dbMock.tokenLog.aggregate.mockReset().mockResolvedValue({ _sum: { costUsd: null, tokensIn: null, tokensOut: null } })
    dbMock.tokenLog.groupBy.mockReset().mockResolvedValue([])
    dbMock.credentialInjection.count.mockResolvedValue(0)
    await digests(req("Bearer cs_test"))
    const data = deliverMock.mock.calls[0][2] as Record<string, unknown>
    expect(data).toMatchObject({ spend_usd: 0, token_cost_usd: 0, approved: 0, denied: 0, escalated: 0, secret_accesses: 0 })
    expect("top_agent" in data).toBe(false)
  })
})
