import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// The adoption-funnel metrics endpoint: admin-secret gated (503 unset, 401 wrong),
// and the funnel counts + conversion rates over real (non-demo) wallets.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { count: vi.fn(), findMany: vi.fn() },
    authorizationRequest: { count: vi.fn() },
    tokenLog: { aggregate: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { GET as metrics } from "../app/api/admin/metrics/route"

const ADMIN = "admin-secret-test"
function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://test.local/api/admin/metrics", { method: "GET", headers })
}

const envBackup = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  process.env.SANCTION_ADMIN_SECRET = ADMIN
  // Promise.all order: total, demo, real, withAgent, withAuthorize, active7d, signups7d, signups30d
  dbMock.wallet.count
    .mockResolvedValueOnce(100) // total
    .mockResolvedValueOnce(70) // demo
    .mockResolvedValueOnce(30) // real
    .mockResolvedValueOnce(20) // provisioned a seat
    .mockResolvedValueOnce(12) // made first decision
    .mockResolvedValueOnce(8) // active 7d
    .mockResolvedValueOnce(5) // signups 7d
    .mockResolvedValueOnce(25) // signups 30d
  dbMock.authorizationRequest.count.mockResolvedValueOnce(4200).mockResolvedValueOnce(310)
  dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 87.65 } })
  dbMock.wallet.findMany.mockResolvedValue([
    { name: "Wayne Enterprises", ownerEmail: "bruce@wayne.co", createdAt: new Date("2026-07-11T00:00:00Z"), _count: { agents: 3 } },
  ])
})
afterEach(() => {
  process.env = { ...envBackup }
})

describe("GET /api/admin/metrics", () => {
  it("503s when the admin secret is not configured", async () => {
    delete process.env.SANCTION_ADMIN_SECRET
    expect((await metrics(req({ "x-admin-secret": "anything" }))).status).toBe(503)
  })

  it("401s on a wrong secret and never queries", async () => {
    const res = await metrics(req({ "x-admin-secret": "wrong" }))
    expect(res.status).toBe(401)
    expect(dbMock.wallet.count).not.toHaveBeenCalled()
  })

  it("returns the funnel with counts and conversion rates over real wallets", async () => {
    const res = await metrics(req({ "x-admin-secret": ADMIN }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.wallets).toEqual({ total: 100, demo: 70, real: 30 })
    expect(body.funnel).toMatchObject({ signups: 30, provisioned_a_seat: 20, made_first_decision: 12, active_last_7d: 8 })
    // 20/30, 12/20, 8/30 as one-decimal percentages
    expect(body.funnel.rates_pct).toEqual({ signup_to_seat: 66.7, seat_to_first_decision: 60, signup_to_active_7d: 26.7 })
    expect(body.signups).toEqual({ last_7d: 5, last_30d: 25 })
    expect(body.activity_real).toEqual({ decisions_total: 4200, decisions_last_7d: 310, token_cost_usd_total: 87.65 })
    expect(body.recent_real_wallets[0]).toMatchObject({ name: "Wayne Enterprises", seats: 3 })
  })

  it("excludes the demo fleet by name prefix in every count", async () => {
    await metrics(req({ "x-admin-secret": ADMIN }))
    // the 'real' count (3rd call) filters NOT name startsWith 'Demo —'
    const realWhere = dbMock.wallet.count.mock.calls[2][0].where
    expect(realWhere).toEqual({ NOT: { name: { startsWith: "Demo —" } } })
  })

  it("handles a zero-signup deployment without dividing by zero", async () => {
    dbMock.wallet.count.mockReset()
    dbMock.wallet.count.mockResolvedValue(0)
    dbMock.authorizationRequest.count.mockResolvedValue(0)
    dbMock.wallet.findMany.mockResolvedValue([])
    const res = await metrics(req({ "x-admin-secret": ADMIN }))
    const body = await res.json()
    expect(body.funnel.rates_pct.signup_to_seat).toBeNull()
  })
})
