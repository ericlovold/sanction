import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Outcomes (CPO-1): operators report results; Sanction counts, never invents.
// Contracts under test: agent-plane write with idempotent dedupe, owner-plane
// summary math (spend ÷ outcomes, ceiling comparison).

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(() => Promise.resolve({})) },
    policy: { findUnique: vi.fn() },
    outcomeEvent: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    authorizationRequest: { aggregate: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { POST as postOutcome, GET as getSummary } from "../app/api/v1/outcomes/route"

const KEY = "pxy_testagentkey"
const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AGENT = {
  id: "agent_1",
  name: "reporter",
  walletId: WID,
  isActive: true,
  expiresAt: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: null },
}
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
})

describe("POST /v1/outcomes", () => {
  it("401 without an agent key; 400 on a bad body", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)
    expect((await postOutcome(req("POST", "/api/v1/outcomes", { body: { kind: "enrollment" } }))).status).toBe(401)
    dbMock.agent.findUnique.mockResolvedValue(AGENT)
    expect(
      (await postOutcome(req("POST", "/api/v1/outcomes", { headers: { "x-api-key": KEY }, body: { kind: "" } }))).status,
    ).toBe(400)
  })

  it("records an outcome against the agent's wallet", async () => {
    dbMock.outcomeEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "oe_1", ...data }))
    const res = await postOutcome(
      req("POST", "/api/v1/outcomes", { headers: { "x-api-key": KEY }, body: { kind: "Enrollment", value_usd: 2400, play: "speed-to-lead" } }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ recorded: true, deduped: false, kind: "enrollment" }) // kind normalized lowercase
    const stored = dbMock.outcomeEvent.create.mock.calls[0][0].data
    expect(stored.walletId).toBe(WID)
    expect(stored.agentId).toBe(AGENT.id)
  })

  it("dedupe_key makes reporting idempotent — same key never double-counts", async () => {
    dbMock.outcomeEvent.findUnique.mockResolvedValue({ id: "oe_1", kind: "enrollment" })
    const res = await postOutcome(
      req("POST", "/api/v1/outcomes", { headers: { "x-api-key": KEY }, body: { kind: "enrollment", dedupe_key: "crm-123" } }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).deduped).toBe(true)
    expect(dbMock.outcomeEvent.create).not.toHaveBeenCalled()
  })
})

describe("GET /v1/outcomes (summary)", () => {
  it("owner-only; requires wallet_id and kind", async () => {
    expect((await getSummary(req("GET", "/api/v1/outcomes?kind=enrollment"))).status).toBe(400)
    expect(
      (await getSummary(req("GET", `/api/v1/outcomes?wallet_id=${WID}&kind=enrollment`, { headers: { "x-mgmt-key": "sk_wrong" } }))).status,
    ).toBe(401)
    expect((await getSummary(req("GET", `/api/v1/outcomes?wallet_id=${WID}`, { headers: { "x-mgmt-key": SK } }))).status).toBe(400)
  })

  it("computes cost-per-outcome and compares against the configured ceiling", async () => {
    dbMock.outcomeEvent.count.mockResolvedValue(10)
    dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1" }])
    dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 3100 } })
    dbMock.policy.findUnique.mockResolvedValue({ outcomeKind: "enrollment", costPerOutcomeCeilingUsd: 30_000, costPerOutcomeMinOutcomes: 5 })

    const res = await getSummary(req("GET", `/api/v1/outcomes?wallet_id=${WID}&kind=enrollment`, { headers: { "x-mgmt-key": SK } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      outcomes: 10,
      window_spend_usd: 3100,
      cost_per_outcome_usd: 310,
      ceiling_usd: 300,
      over_ceiling: true,
      governed: true,
    })
  })
})
