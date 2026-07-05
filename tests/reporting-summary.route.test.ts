import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// REPORT-1: period summaries, projections, and the CSV export. Pure math
// (rangeUtc, toCsv, monthlyPace + the strengthened morning guard) plus the
// /reporting/summary route's auth, defaults, buckets, and per-agent grouping.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    tokenLog: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    credentialInjection: { count: vi.fn(), findMany: vi.fn() },
    pendingApproval: { count: vi.fn() },
    policy: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: vi.fn(async () => ({ wallet: null })) }))

import { rangeUtc, toCsv } from "../lib/reporting"
import { monthlyPace, dailyPace } from "../lib/burn"
import { GET as summary } from "../app/api/v1/reporting/summary/route"
import { GET as auditEvents } from "../app/api/v1/audit-events/route"
import { GET as stats } from "../app/api/v1/wallets/stats/route"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"

const AGENT = {
  id: "agent_1",
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "o@example.com", policy: null },
}

function getReq(path: string, key: string | null = KEY) {
  const headers: Record<string, string> = {}
  if (key) headers["x-api-key"] = key
  return new NextRequest(`https://test.local${path}`, { method: "GET", headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet" }])
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 120 } })
  dbMock.authorizationRequest.groupBy.mockResolvedValue([
    { status: "approved", _count: { _all: 8 }, _sum: { amountUsd: 120 }, agentId: "agent_1" },
    { status: "denied", _count: { _all: 3 }, _sum: { amountUsd: 0 }, agentId: "agent_1" },
  ])
  dbMock.authorizationRequest.findMany.mockResolvedValue([])
  dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 4.2, tokensIn: 1000, tokensOut: 500 } })
  dbMock.tokenLog.groupBy.mockResolvedValue([{ agentId: "agent_1", _sum: { costUsd: 4.2 } }])
  dbMock.tokenLog.findMany.mockResolvedValue([])
  dbMock.credentialInjection.count.mockResolvedValue(2)
  dbMock.pendingApproval.count.mockResolvedValue(0)
  dbMock.policy.findUnique.mockResolvedValue({ dailySpendBudgetUsd: 20_000, monthlySpendBudgetUsd: 500_000 })
  dbMock.$queryRaw.mockResolvedValue([])
})

describe("lib math", () => {
  it("rangeUtc validates order and span", () => {
    const r = rangeUtc("2026-07-01", "2026-07-07")
    expect(r.end.getTime() - r.start.getTime()).toBe(7 * 86_400_000)
    expect(() => rangeUtc("2026-07-07", "2026-07-01")).toThrow(/on or after/)
    expect(() => rangeUtc("2026-01-01", "2026-06-01")).toThrow(/max 92/)
  })

  it("neutralizes spreadsheet formula triggers in agent-supplied fields", () => {
    const csv = toCsv([{ at: "t", type: "x", merchant: "=HYPERLINK(\"evil\")", category: "-2+3+cmd", task_label: "@sum" }])
    const row = csv.split("\n")[1]
    expect(row).toContain("'=HYPERLINK")
    expect(row).toContain("'-2+3+cmd")
    expect(row).toContain("'@sum")
  })

  it("toCsv escapes quotes, commas, and newlines", () => {
    const csv = toCsv([{ at: "t", type: "x", reason: 'said "no", twice' }])
    expect(csv.split("\n")[0].startsWith("at,type,id")).toBe(true)
    expect(csv).toContain('"said ""no"", twice"')
  })

  it("monthlyPace guards early month, projects mid-month, flags exhaustion", () => {
    const early = new Date(2026, 6, 1, 12, 0, 0) // ~1.6% of July elapsed
    expect(monthlyPace(50, 1000, early).onPace).toBeNull()

    const mid = new Date(2026, 6, 16, 0, 0, 0) // 15/31 days = ~48.4% elapsed
    const p = monthlyPace(400, 1000, mid)
    expect(p.onPace).toBeCloseTo(826.7, 0)
    expect(p.willExhaust).toBe(false)

    const hot = monthlyPace(900, 1000, mid)
    expect(hot.willExhaust).toBe(true)
    expect(hot.exhaustAt).toBeInstanceOf(Date)
    expect(monthlyPace(900, null, mid).pctOfCap).toBeNull()
  })

  it("dailyPace morning guard suppresses the first ~72 minutes", () => {
    const early = new Date()
    early.setHours(0, 30, 0, 0)
    expect(dailyPace(40, 100, early).onPace).toBeNull()
    const later = new Date()
    later.setHours(12, 0, 0, 0)
    expect(dailyPace(40, 100, later).onPace).toBeCloseTo(80, 0)
  })
})

describe("GET /v1/reporting/summary", () => {
  it("401s without membership", async () => {
    const res = await summary(getReq(`/api/v1/reporting/summary?wallet_id=${WID}`, null))
    expect(res.status).toBe(401)
  })

  it("400s a reversed range", async () => {
    const res = await summary(getReq(`/api/v1/reporting/summary?wallet_id=${WID}&from=2026-07-04&to=2026-07-01`))
    expect(res.status).toBe(400)
  })

  it("returns totals and day buckets for the default week", async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-07-03T00:00:00Z"), spend: 120, approved: BigInt(8), denied: BigInt(3), escalated: BigInt(0) }])
      .mockResolvedValueOnce([{ day: new Date("2026-07-03T00:00:00Z"), cost: 4.2 }])
    const res = await summary(getReq(`/api/v1/reporting/summary?wallet_id=${WID}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals.spend_usd).toBe(120)
    expect(body.totals.decisions.denied).toBe(3)
    expect(body.totals.secret_accesses).toBe(2)
    expect(body.days).toEqual([
      { date: "2026-07-03", spend_usd: 120, approved: 8, denied: 3, escalated: 0, token_cost_usd: 4.2 },
    ])
    expect(body.by_agent).toBeUndefined()
  })

  it("groups by agent when asked, including idle agents zeroed", async () => {
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", name: "tenet" },
      { id: "agent_idle", name: "sleeper" },
    ])
    const res = await summary(getReq(`/api/v1/reporting/summary?wallet_id=${WID}&group_by=agent`))
    const body = await res.json()
    expect(body.by_agent).toHaveLength(2)
    const idle = body.by_agent.find((a: { agent_id: string }) => a.agent_id === "agent_idle")
    expect(idle).toEqual(expect.objectContaining({ agent_name: "sleeper", spend_usd: 0, token_cost_usd: 0 }))
    expect(body.by_agent[0]).toEqual(
      expect.objectContaining({ agent_id: "agent_1", agent_name: "tenet", spend_usd: 120, denied: 3, token_cost_usd: 4.2 }),
    )
  })
})

describe("GET /v1/wallets/stats — projections", () => {
  it("carries budget, projection, and exhaustion fields for day and month", async () => {
    const res = await stats(getReq(`/api/v1/wallets/stats?wallet_id=${WID}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today.spend_budget_usd).toBe(200)
    expect(body.month.spend_budget_usd).toBe(5000)
    // Projection values depend on wall clock; the fields must exist and be
    // number-or-null (the guards make early hours null — both are valid).
    expect("projected_spend_usd" in body.month).toBe(true)
    expect(typeof body.month.will_exhaust).toBe("boolean")
  })

  it("handles wallets without a policy (null budgets, no projection)", async () => {
    dbMock.policy.findUnique.mockResolvedValue(null)
    const body = await (await stats(getReq(`/api/v1/wallets/stats?wallet_id=${WID}`))).json()
    expect(body.today.spend_budget_usd).toBeNull()
    expect(body.month.spend_budget_usd).toBeNull()
  })
})

describe("GET /v1/audit-events?format=csv", () => {
  it("returns the same page as spreadsheet-ready CSV", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-07-04T12:00:00Z"), agentId: "agent_1", action: "purchase", amountUsd: 60, merchant: "github, inc", category: "software", status: "denied", decisionNote: "Exceeds per-transaction limit of $100" },
    ])
    dbMock.tokenLog.findMany.mockResolvedValue([])
    dbMock.credentialInjection.findMany.mockResolvedValue([])
    const res = await auditEvents(getReq(`/api/v1/audit-events?wallet_id=${WID}&format=csv`))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toContain("attachment")
    const csv = await res.text()
    const lines = csv.trim().split("\n")
    expect(lines[0].startsWith("at,type,id,agent_id,agent_name")).toBe(true)
    expect(lines[1]).toContain("authorization.denied")
    expect(lines[1]).toContain('"github, inc"')
  })
})
