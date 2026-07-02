import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Route tests for GET /v1/audit-events — the unified audit feed. Verifies the
// membership gate (owner OR wallet agent), the merge/sort across the three audit
// sources, the `type` filter, `before` validation, and cursor pagination.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { findMany: vi.fn() },
    tokenLog: { findMany: vi.fn() },
    credentialInjection: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

const { authMock } = vi.hoisted(() => ({
  authMock: { authenticateOwner: vi.fn(), authenticateAgent: vi.fn() },
}))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: authMock.authenticateOwner }))
vi.mock("@/lib/auth", () => ({ authenticateAgent: authMock.authenticateAgent }))

import { GET as auditEvents } from "../app/api/v1/audit-events/route"

const WID = "wallet_1"

function req(qs: string) {
  return new NextRequest(`https://test.local/api/v1/audit-events${qs}`)
}

const AGENTS = [{ id: "agent_1", name: "tenet" }]

beforeEach(() => {
  vi.clearAllMocks()
  // Default: owner authenticates.
  authMock.authenticateOwner.mockResolvedValue({ wallet: { id: WID } })
  authMock.authenticateAgent.mockResolvedValue({ agent: null })
  dbMock.agent.findMany.mockResolvedValue(AGENTS)
  dbMock.authorizationRequest.findMany.mockResolvedValue([
    { id: "req_1", status: "approved", createdAt: new Date("2026-06-17T03:00:00Z"), agentId: "agent_1", action: "purchase", amountUsd: 5, merchant: "anthropic", category: "software", decisionNote: "Auto-approved" },
  ])
  dbMock.tokenLog.findMany.mockResolvedValue([
    { id: "tok_1", createdAt: new Date("2026-06-17T02:00:00Z"), agentId: "agent_1", model: "claude", costUsd: 0.02, tokensIn: 100, tokensOut: 50, taskLabel: "task" },
  ])
  dbMock.credentialInjection.findMany.mockResolvedValue([
    { id: "inj_1", injectedAt: new Date("2026-06-17T01:00:00Z"), executionTokenId: "exec_1", credential: { label: "github" }, executionToken: { agentId: "agent_1" } },
  ])
})

describe("GET /audit-events — auth gate", () => {
  it("400 without wallet_id", async () => {
    expect((await auditEvents(req(""))).status).toBe(400)
  })

  it("401 when neither owner nor a wallet agent authenticates", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: null })
    expect((await auditEvents(req(`?wallet_id=${WID}`))).status).toBe(401)
  })

  it("401 when the agent belongs to a different wallet", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: { walletId: "other_wallet" } })
    expect((await auditEvents(req(`?wallet_id=${WID}`))).status).toBe(401)
  })

  it("allows a wallet agent (x-api-key) when owner auth fails", async () => {
    authMock.authenticateOwner.mockResolvedValue({ wallet: null })
    authMock.authenticateAgent.mockResolvedValue({ agent: { walletId: WID } })
    expect((await auditEvents(req(`?wallet_id=${WID}`))).status).toBe(200)
  })
})

describe("GET /audit-events — feed", () => {
  it("merges the three sources into one desc-by-time feed", async () => {
    const res = await auditEvents(req(`?wallet_id=${WID}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.wallet_id).toBe(WID)
    expect(body.events.map((e: { type: string }) => e.type)).toEqual([
      "authorization.approved", // 03:00
      "token.logged", // 02:00
      "vault.injection", // 01:00
    ])
    // Enriched with agent_name from the wallet's agents.
    expect(body.events[0]).toMatchObject({ agent_name: "tenet", amount_usd: 5, merchant: "anthropic" })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("type=token queries only the token source", async () => {
    const res = await auditEvents(req(`?wallet_id=${WID}&type=token`))
    const body = await res.json()
    expect(body.events.every((e: { type: string }) => e.type === "token.logged")).toBe(true)
    expect(dbMock.authorizationRequest.findMany).not.toHaveBeenCalled()
    expect(dbMock.credentialInjection.findMany).not.toHaveBeenCalled()
  })

  it("400 on a malformed `before` timestamp", async () => {
    expect((await auditEvents(req(`?wallet_id=${WID}&before=not-a-date`))).status).toBe(400)
  })

  it("returns a next_before cursor when the page is full", async () => {
    // limit=1 → one event returned → cursor is that event's timestamp.
    const res = await auditEvents(req(`?wallet_id=${WID}&limit=1`))
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.next_before).toBe("2026-06-17T03:00:00.000Z")
  })

  it("next_before is null when the page is not full", async () => {
    const res = await auditEvents(req(`?wallet_id=${WID}`))
    const body = await res.json()
    expect(body.next_before).toBeNull()
  })
})
