import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler tests for the audit plane: GET /v1/audit-events (unified feed)
// and GET /v1/reporting/daily-summary (one-day rollup). Merge/sort/day-range math
// is proven in reporting.test.ts; here we prove the routes: the membership gate
// fails closed, filters and cursors validate, and the response shapes hold.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    wallet: { findUnique: vi.fn() },
    authorizationRequest: { findMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    tokenLog: { findMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    credentialInjection: { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { GET as auditEvents } from "../app/api/v1/audit-events/route"
import { GET as dailySummary } from "../app/api/v1/reporting/daily-summary/route"

const KEY = "pxy_testagentkey"
const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AID = "agent_1"

const AGENT = {
  id: AID,
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: null },
}
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://test.local" + url, { method: "GET", headers })
}
const agentH = { "x-api-key": KEY }
const mgmtH = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.agent.findMany.mockResolvedValue([{ id: AID, name: "tenet" }])
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.authorizationRequest.findMany.mockResolvedValue([])
  dbMock.tokenLog.findMany.mockResolvedValue([])
  dbMock.credentialInjection.findMany.mockResolvedValue([])
})

// ── /v1/audit-events ─────────────────────────────────────────────────────────

describe("audit-events — membership gate fails closed", () => {
  it("400 without wallet_id", async () => {
    expect((await auditEvents(req("/api/v1/audit-events"))).status).toBe(400)
  })

  it("401 with no credentials — the wallet_id alone reads nothing", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue(null)
    expect((await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}`))).status).toBe(401)
  })

  it("401 for an agent key from a different wallet", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, walletId: "wallet_other" })
    expect((await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}`, agentH))).status).toBe(401)
  })

  it("400 on a malformed before cursor", async () => {
    expect((await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}&before=yesterdayish`, mgmtH))).status).toBe(400)
  })
})

describe("audit-events — the unified feed", () => {
  const T1 = new Date("2026-07-03T10:00:00Z")
  const T2 = new Date("2026-07-03T11:00:00Z")
  const T3 = new Date("2026-07-03T12:00:00Z")

  it("merges decisions, token logs, and injections into one time-sorted feed with no-store", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", agentId: AID, action: "purchase", amountUsd: 5, merchant: "Anthropic", category: "software", status: "approved", decisionNote: "Auto-approved", createdAt: T1 },
    ])
    dbMock.tokenLog.findMany.mockResolvedValue([
      { id: "t1", agentId: AID, model: "claude-sonnet-5", costUsd: 0.05, tokensIn: 100, tokensOut: 50, taskLabel: "nightly", createdAt: T3 },
    ])
    dbMock.credentialInjection.findMany.mockResolvedValue([
      { id: "i1", injectedAt: T2, executionTokenId: "jti1", credential: { label: "openai" }, executionToken: { agentId: AID } },
    ])

    const res = await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}`, mgmtH))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    // Newest first, all three sources interleaved, agent names resolved.
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(["token.logged", "vault.injection", "authorization.approved"])
    expect(body.events[1]).toMatchObject({ credential_label: "openai", agent_name: "tenet" })
    expect(body.next_before).toBeNull() // fewer than limit → no next page
  })

  it("filters by type: token-only skips the other tables entirely", async () => {
    dbMock.tokenLog.findMany.mockResolvedValue([])
    const res = await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}&type=token`, mgmtH))
    expect(res.status).toBe(200)
    expect(dbMock.authorizationRequest.findMany).not.toHaveBeenCalled()
    expect(dbMock.credentialInjection.findMany).not.toHaveBeenCalled()
  })

  it("emits a next_before cursor when the page is full", async () => {
    dbMock.tokenLog.findMany.mockResolvedValue([
      { id: "t1", agentId: AID, model: "m", costUsd: 1, tokensIn: 1, tokensOut: 1, taskLabel: null, createdAt: T2 },
      { id: "t2", agentId: AID, model: "m", costUsd: 1, tokensIn: 1, tokensOut: 1, taskLabel: null, createdAt: T1 },
    ])
    const res = await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}&type=token&limit=2`, mgmtH))
    const body = await res.json()
    expect(body.events).toHaveLength(2)
    expect(body.next_before).toBe(T1.toISOString()) // oldest event on the page
  })

  it("serves an in-wallet agent via its API key", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null) // no mgmt key presented
    expect((await auditEvents(req(`/api/v1/audit-events?wallet_id=${WID}`, agentH))).status).toBe(200)
  })
})

// ── /v1/reporting/daily-summary ──────────────────────────────────────────────

describe("daily-summary — one-day rollup", () => {
  beforeEach(() => {
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 42 } })
    dbMock.authorizationRequest.groupBy.mockResolvedValue([
      { status: "approved", _count: { _all: 7 } },
      { status: "escalated", _count: { _all: 2 } },
    ])
    dbMock.tokenLog.aggregate.mockResolvedValue({ _sum: { costUsd: 3.5, tokensIn: 1000, tokensOut: 400 } })
    dbMock.credentialInjection.count.mockResolvedValue(3)
    dbMock.tokenLog.groupBy.mockResolvedValue([
      { taskLabel: "nightly-refactor", _sum: { costUsd: 2.5 } },
      { taskLabel: null, _sum: { costUsd: 1.0 } },
    ])
  })

  it("400 without wallet_id, 400 on a malformed date", async () => {
    expect((await dailySummary(req("/api/v1/reporting/daily-summary"))).status).toBe(400)
    expect((await dailySummary(req(`/api/v1/reporting/daily-summary?wallet_id=${WID}&date=July-3rd`, mgmtH))).status).toBe(400)
  })

  it("401 with no credentials", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue(null)
    expect((await dailySummary(req(`/api/v1/reporting/daily-summary?wallet_id=${WID}`))).status).toBe(401)
  })

  it("rolls up the day: spend, decision counts, token cost, secret accesses, costliest tasks", async () => {
    const res = await dailySummary(req(`/api/v1/reporting/daily-summary?wallet_id=${WID}&date=2026-07-03`, mgmtH))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body).toMatchObject({
      date: "2026-07-03",
      spend_usd: 42,
      decisions: { approved: 7, escalated: 2, denied: 0, pending: 0 },
      token_cost_usd: 3.5,
      secret_accesses: 3,
    })
    expect(body.most_expensive_tasks).toEqual([
      { task_label: "nightly-refactor", cost_usd: 2.5 },
      { task_label: "(untagged)", cost_usd: 1.0 },
    ])
  })

  it("serves an in-wallet agent via its API key", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await dailySummary(req(`/api/v1/reporting/daily-summary?wallet_id=${WID}`, agentH))).status).toBe(200)
  })
})
