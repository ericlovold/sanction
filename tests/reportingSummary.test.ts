import { describe, it, expect, vi, beforeEach } from "vitest"

// Console parity PR3: buildPeriodSummary — the reporting read model lifted out
// of /api/v1/reporting/summary so the dashboard and the REST route share it.
// The route tests prove the HTTP contract; these prove the extracted math
// directly: the two date_trunc day-buckets merge, group_by=agent zeroes idle
// seats, and the totals fold.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), groupBy: vi.fn() },
    tokenLog: { aggregate: vi.fn(), groupBy: vi.fn() },
    credentialInjection: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { buildPeriodSummary } from "../lib/reportingSummary"

const RANGE = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-08T00:00:00Z") }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet" }])
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 120 } })
  dbMock.authorizationRequest.groupBy.mockResolvedValue([{ status: "approved", _count: { _all: 8 } }])
  dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 4.2, tokensIn: 1000, tokensOut: 500 } })
  dbMock.tokenLog.groupBy.mockResolvedValue([])
  dbMock.credentialInjection.count.mockResolvedValue(2)
  dbMock.$queryRaw.mockResolvedValue([])
})

describe("buildPeriodSummary", () => {
  it("folds the totals from the aggregate queries", async () => {
    const s = await buildPeriodSummary("wallet_1", RANGE)
    expect(s.totals.spend_usd).toBe(120)
    expect(s.totals.token_cost_usd).toBe(4.2)
    expect(s.totals.tokens_in).toBe(1000)
    expect(s.totals.tokens_out).toBe(500)
    expect(s.totals.secret_accesses).toBe(2)
    expect(s.totals.decisions.approved).toBe(8)
    expect(s.by_agent).toBeUndefined() // not requested
  })

  it("merges the spend and token day-buckets, zero-filling the missing side", async () => {
    // $queryRaw is called twice in Promise.all order: spendDays, then tokenDays.
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-07-01T00:00:00Z"), spend: 100, approved: 5, denied: 2, escalated: 1 }])
      .mockResolvedValueOnce([{ day: new Date("2026-07-02T00:00:00Z"), cost: 3.5 }])
    const s = await buildPeriodSummary("wallet_1", RANGE)
    expect(s.days).toEqual([
      { date: "2026-07-01", spend_usd: 100, approved: 5, denied: 2, escalated: 1, token_cost_usd: 0 },
      { date: "2026-07-02", spend_usd: 0, approved: 0, denied: 0, escalated: 0, token_cost_usd: 3.5 },
    ])
  })

  it("group_by=agent lists every agent, zeroing the idle ones", async () => {
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", name: "busy" },
      { id: "agent_2", name: "idle" },
    ])
    // groupBy(authorizationRequest) is called twice: decisions, then per-agent.
    dbMock.authorizationRequest.groupBy
      .mockResolvedValueOnce([{ status: "approved", _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ agentId: "agent_1", status: "approved", _sum: { amountUsd: 50 }, _count: { _all: 3 } }])
    dbMock.tokenLog.groupBy.mockResolvedValue([{ agentId: "agent_1", _sum: { costUsd: 2 } }])

    const s = await buildPeriodSummary("wallet_1", { ...RANGE, groupByAgent: true })
    const idle = s.by_agent?.find((a) => a.agent_id === "agent_2")
    expect(idle).toEqual({ agent_id: "agent_2", agent_name: "idle", spend_usd: 0, approved: 0, denied: 0, escalated: 0, token_cost_usd: 0 })
    const busy = s.by_agent?.find((a) => a.agent_id === "agent_1")
    expect(busy).toMatchObject({ spend_usd: 50, approved: 3, token_cost_usd: 2 })
  })
})
