import { describe, it, expect, vi, beforeEach } from "vitest"

// Console parity PR3: buildAuditFeed — the unified audit read model lifted out
// of /api/v1/audit-events so the dashboard page + cookie-authed CSV export and
// the REST route share it. mergeEvents/authEventType stay real (pure); only db
// is mocked. Proves the merge/sort, the next_before cursor, and type filtering.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { findMany: vi.fn() },
    tokenLog: { findMany: vi.fn() },
    credentialInjection: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { buildAuditFeed } from "../lib/auditFeed"

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet" }])
  dbMock.authorizationRequest.findMany.mockResolvedValue([])
  dbMock.tokenLog.findMany.mockResolvedValue([])
  dbMock.credentialInjection.findMany.mockResolvedValue([])
})

describe("buildAuditFeed", () => {
  it("merges the three tables into one time-sorted stream", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-07-03T10:00:00Z"), agentId: "agent_1", status: "approved", action: "spend", amountUsd: 12, merchant: "AWS", category: "cloud", decisionNote: null },
    ])
    dbMock.tokenLog.findMany.mockResolvedValue([
      { id: "t1", createdAt: new Date("2026-07-03T12:00:00Z"), agentId: "agent_1", model: "claude", costUsd: 0.4, tokensIn: 10, tokensOut: 5, taskLabel: null },
    ])
    const feed = await buildAuditFeed("wallet_1", { limit: 50 })
    expect(feed.events.map((e) => e.id)).toEqual(["t1", "a1"]) // newest first
    expect(feed.events[0]).toMatchObject({ type: "token.logged", agent_name: "tenet", cost_usd: 0.4 })
    expect(feed.events[1]).toMatchObject({ agent_name: "tenet", merchant: "AWS", amount_usd: 12 })
    expect(feed.next_before).toBeNull() // fewer than limit → no cursor
  })

  it("returns a next_before cursor when the page is full", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-07-03T10:00:00Z"), agentId: "agent_1", status: "approved", action: "s", amountUsd: 1, merchant: "m", category: "c", decisionNote: null },
      { id: "a2", createdAt: new Date("2026-07-02T10:00:00Z"), agentId: "agent_1", status: "denied", action: "s", amountUsd: 2, merchant: "m", category: "c", decisionNote: "PER_TXN_LIMIT" },
    ])
    const feed = await buildAuditFeed("wallet_1", { limit: 2 })
    expect(feed.events).toHaveLength(2)
    expect(feed.next_before).toBe("2026-07-02T10:00:00.000Z") // oldest event's timestamp
  })

  it("renders an injection whose vault row is RLS-shielded (null relation) instead of crashing", async () => {
    // Outside a tenant transaction, RLS hides the joined CredentialVault row and
    // Prisma returns null for the required relation. Found live by the demo-company
    // driver: a child pool's injection crashed the org owner's Audit page.
    dbMock.credentialInjection.findMany.mockResolvedValue([
      { id: "i1", injectedAt: new Date("2026-07-03T11:00:00Z"), executionTokenId: "jti_1", executionToken: { agentId: "agent_1" }, credential: null },
    ])
    const feed = await buildAuditFeed("wallet_1", { limit: 50 })
    expect(feed.events[0]).toMatchObject({ type: "vault.injection", agent_name: "tenet" })
    expect(feed.events[0].credential_label).toBeUndefined()
  })

  it("honors a type filter — only queries the requested table", async () => {
    await buildAuditFeed("wallet_1", { type: "token", limit: 50 })
    expect(dbMock.tokenLog.findMany).toHaveBeenCalledTimes(1)
    expect(dbMock.authorizationRequest.findMany).not.toHaveBeenCalled()
    expect(dbMock.credentialInjection.findMany).not.toHaveBeenCalled()
  })
})

describe("buildAuditFeed — org subtree scope", () => {
  it("accepts an array of wallet ids and stamps each event with its pool", async () => {
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", name: "tenet", wallet: { name: "Engineering" } },
      { id: "agent_2", name: "sator", wallet: { name: "Marketing" } },
    ])
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-07-03T10:00:00Z"), agentId: "agent_2", status: "approved", action: "spend", amountUsd: 3, merchant: "m", category: "c", decisionNote: null },
    ])
    const feed = await buildAuditFeed(["wallet_root", "wallet_child"], { limit: 50 })
    expect(dbMock.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId: { in: ["wallet_root", "wallet_child"] } } }),
    )
    expect(dbMock.credentialInjection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ executionToken: { walletId: { in: ["wallet_root", "wallet_child"] } } }) }),
    )
    expect(feed.events[0]).toMatchObject({ agent_name: "sator", pool: "Marketing" })
  })

  it("a single-element array behaves like a plain wallet id — no pool stamping", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-07-03T10:00:00Z"), agentId: "agent_1", status: "approved", action: "spend", amountUsd: 3, merchant: "m", category: "c", decisionNote: null },
    ])
    const feed = await buildAuditFeed(["wallet_1"], { limit: 50 })
    expect(feed.events[0].pool).toBeUndefined()
  })
})
