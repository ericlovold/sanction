import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// The admin plane (x-admin-secret, constant-time compare, disabled-when-unset)
// and the small data-plane probes: /v1/activity and the one-time management-key
// bootstrap. Shared theme: every one of these fails closed — no secret configured
// means 503 (not open), wrong secret means 401, and bootstrap refuses to
// overwrite an existing key.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    wallet: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    tokenLog: { findFirst: vi.fn(), count: vi.fn() },
    authorizationRequest: { count: vi.fn() },
    lead: { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { GET as activity } from "../app/api/v1/activity/route"
import { POST as bootstrapKey } from "../app/api/v1/wallets/bootstrap-key/route"
import { GET as exportLeads } from "../app/api/admin/leads/route"
import { GET as pulse } from "../app/api/admin/pulse/route"

const KEY = "pxy_testagentkey"
const ADMIN = "admin-secret-test"
const AGENT = {
  id: "agent_1",
  walletId: "wallet_1",
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: "wallet_1", ownerEmail: "owner@example.com", policy: null },
}

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

const envBackup = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  process.env.SANCTION_ADMIN_SECRET = ADMIN
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
})
afterEach(() => {
  process.env.SANCTION_ADMIN_SECRET = envBackup.SANCTION_ADMIN_SECRET
})

// ── /v1/activity ─────────────────────────────────────────────────────────────

describe("activity — first-call probe", () => {
  it("401 without an agent key", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)
    expect((await activity(req("GET", "/api/v1/activity"))).status).toBe(401)
  })

  it("reports firstCall=false before any gateway call, true after", async () => {
    dbMock.tokenLog.findFirst.mockResolvedValue(null)
    const before = await activity(req("GET", "/api/v1/activity", { headers: { "x-api-key": KEY } }))
    expect((await before.json())).toMatchObject({ firstCall: false, last: null })

    dbMock.tokenLog.findFirst.mockResolvedValue({ model: "claude-sonnet-5", tokensIn: 10, tokensOut: 5, costUsd: 0.01, createdAt: new Date() })
    const after = await activity(req("GET", "/api/v1/activity", { headers: { "x-api-key": KEY } }))
    const body = await after.json()
    expect(body.firstCall).toBe(true)
    expect(body.last.model).toBe("claude-sonnet-5")
  })
})

// ── /v1/wallets/bootstrap-key ────────────────────────────────────────────────

describe("bootstrap-key — one-time legacy key mint", () => {
  it("503 when SANCTION_ADMIN_SECRET is unset (disabled, not open)", async () => {
    delete process.env.SANCTION_ADMIN_SECRET
    expect((await bootstrapKey(req("POST", "/api/v1/wallets/bootstrap-key", { body: { wallet_id: "w1" } }))).status).toBe(503)
  })

  it("401 on a wrong admin secret", async () => {
    const res = await bootstrapKey(req("POST", "/api/v1/wallets/bootstrap-key", { headers: { "x-admin-secret": "nope" }, body: { wallet_id: "w1" } }))
    expect(res.status).toBe(401)
  })

  it("409 refuses to overwrite a wallet that already has a management key", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ id: "w1", mgmtKeyHash: "existing" })
    const res = await bootstrapKey(req("POST", "/api/v1/wallets/bootstrap-key", { headers: { "x-admin-secret": ADMIN }, body: { wallet_id: "w1" } }))
    expect(res.status).toBe(409)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  it("mints once for a legacy wallet: sk_ key returned, only the hash stored, no-store", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ id: "w1", mgmtKeyHash: null })
    dbMock.wallet.update.mockResolvedValue({})
    const res = await bootstrapKey(req("POST", "/api/v1/wallets/bootstrap-key", { headers: { "x-admin-secret": ADMIN }, body: { wallet_id: "w1" } }))
    expect(res.status).toBe(201)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.management_key).toMatch(/^sk_/)
    const stored = dbMock.wallet.update.mock.calls[0][0].data
    expect(stored.mgmtKeyHash).toBe(hashApiKey(body.management_key))
  })
})

// ── /admin/leads + /admin/pulse ──────────────────────────────────────────────

describe("admin plane — leads export and adoption pulse", () => {
  it("both endpoints 503 when the admin secret is unconfigured", async () => {
    delete process.env.SANCTION_ADMIN_SECRET
    expect((await exportLeads(req("GET", "/api/admin/leads"))).status).toBe(503)
    expect((await pulse(req("GET", "/api/admin/pulse"))).status).toBe(503)
  })

  it("both endpoints 401 a wrong secret", async () => {
    expect((await exportLeads(req("GET", "/api/admin/leads", { headers: { "x-admin-secret": "nope" } }))).status).toBe(401)
    expect((await pulse(req("GET", "/api/admin/pulse", { headers: { "x-admin-secret": "nope" } }))).status).toBe(401)
  })

  it("exports leads as CSV with quoting, or JSON on request", async () => {
    dbMock.lead.findMany.mockResolvedValue([
      { email: "a@x.com", source: "landing", createdAt: new Date("2026-07-01T00:00:00Z") },
      { email: 'weird,"name"@x.com', source: null, createdAt: new Date("2026-07-02T00:00:00Z") },
    ])
    const csv = await exportLeads(req("GET", "/api/admin/leads", { headers: { "x-admin-secret": ADMIN } }))
    expect(csv.headers.get("content-type")).toContain("text/csv")
    const text = await csv.text()
    expect(text.split("\n")[0]).toBe("email,source,created_at")
    expect(text).toContain('"weird,""name""@x.com"') // CSV escaping holds

    const json = await exportLeads(req("GET", "/api/admin/leads?format=json", { headers: { "x-admin-secret": ADMIN } }))
    expect((await json.json()).count).toBe(2)
  })

  it("pulse separates external adoption from dogfooding", async () => {
    process.env.SANCTION_WALLET_ID = "wallet_internal"
    process.env.SANCTION_INTERNAL_EMAILS = "eric@getsanction.com"
    dbMock.wallet.count.mockResolvedValue(10)
    dbMock.agent.count.mockResolvedValue(12)
    dbMock.lead.count.mockResolvedValue(30)
    dbMock.authorizationRequest.count.mockResolvedValue(200)
    dbMock.tokenLog.count.mockResolvedValue(400)
    dbMock.wallet.findMany.mockResolvedValue([
      { name: "Ext A", ownerEmail: "a@x.com", createdAt: new Date(), agents: [{ _count: { authRequests: 3, tokenLogs: 2 } }] },
      { name: "Ext B", ownerEmail: "b@x.com", createdAt: new Date(), agents: [{ _count: { authRequests: 0, tokenLogs: 0 } }] },
    ])
    const res = await pulse(req("GET", "/api/admin/pulse", { headers: { "x-admin-secret": ADMIN } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals).toEqual({ wallets: 10, agents: 12, leads: 30 })
    expect(body.external).toMatchObject({ wallets: 2, active: 1 })
    // the internal wallet id + emails are excluded from the external query
    const where = dbMock.wallet.findMany.mock.calls[0][0].where
    expect(where.id.notIn).toEqual(["wallet_internal"])
    expect(where.ownerEmail.notIn).toEqual(["eric@getsanction.com"])
  })
})
