import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Console parity PR3: the cookie-authed dashboard CSV export. A browser download
// can't send x-mgmt-key, so this route gates on the SESSION wallet — demo view
// (no session) must get a 401, never a silent export of someone's audit trail.
const { sessionMock, feedMock } = vi.hoisted(() => ({
  sessionMock: { getSessionWallet: vi.fn() },
  feedMock: vi.fn(),
}))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/auditFeed", () => ({ buildAuditFeed: feedMock }))

import { GET } from "../app/dashboard/audit/export/route"

function req(path = "/dashboard/audit/export") {
  return new NextRequest(`https://test.local${path}`, { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.getSessionWallet.mockResolvedValue({ id: "wallet_1", name: "acme" })
  feedMock.mockResolvedValue({
    events: [{ type: "spend.approved", id: "a1", at: "2026-07-03T10:00:00.000Z", agent_id: "agent_1", agent_name: "tenet", amount_usd: 12 }],
    next_before: null,
  })
})

describe("audit CSV export route", () => {
  it("fails closed with 401 and no read when there is no session (demo view)", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(feedMock).not.toHaveBeenCalled()
  })

  it("streams CSV with attachment headers on the happy path", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition")).toContain('attachment; filename="sanction-audit-wallet_1.csv"')
    const body = await res.text()
    expect(body).toContain("spend.approved")
    expect(feedMock).toHaveBeenCalledWith("wallet_1", { type: null, limit: 200 })
  })
})
