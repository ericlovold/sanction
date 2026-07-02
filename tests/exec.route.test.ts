import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// POST /v1/exec — scoped execution-token issuance. The unit-level proof of:
// SEC-13 (the JWT response is no-store), AUTHZ-JTI (the returned jti IS the
// ExecutionToken row id), and the issuance gates (scope must exist, agent
// allow-list, clearance ≥ minClearance). The full issue→inject→revoke round
// trip is proven against real Postgres in e2e.db.test.ts.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    agentClearance: { findUnique: vi.fn() },
    credentialVault: { findMany: vi.fn() },
    executionToken: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// RLS isolation is proven in rls.db.test.ts; here withTenant hands back the mock.
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))

import { POST as issueExec } from "../app/api/v1/exec/route"

const KEY = "pxy_testagentkey"
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

const OPENAI_CRED = { label: "openai", allowedAgentIds: [], minClearance: 1 }

function req(body: unknown, opts: { key?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.key !== null) headers["x-api-key"] = opts.key ?? KEY
  return new NextRequest("https://test.local/api/v1/exec", { method: "POST", headers, body: JSON.stringify(body) })
}

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.agentClearance.findUnique.mockResolvedValue({ level: 2 })
  dbMock.credentialVault.findMany.mockResolvedValue([OPENAI_CRED])
  dbMock.executionToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data)
})

describe("exec — issuance gates", () => {
  it("401 without an API key", async () => {
    expect((await issueExec(req({ scope: ["openai"], budget_usd: 5 }, { key: null }))).status).toBe(401)
  })

  it("400 on an empty scope (a token must be for something)", async () => {
    expect((await issueExec(req({ scope: [], budget_usd: 5 }))).status).toBe(400)
  })

  it("400 on a TTL outside the 60s–1h clamp", async () => {
    expect((await issueExec(req({ scope: ["openai"], budget_usd: 5, ttl_seconds: 30 }))).status).toBe(400)
    expect((await issueExec(req({ scope: ["openai"], budget_usd: 5, ttl_seconds: 7200 }))).status).toBe(400)
  })

  it("403 with the denied labels when a scoped credential doesn't exist", async () => {
    dbMock.credentialVault.findMany.mockResolvedValue([])
    const res = await issueExec(req({ scope: ["openai"], budget_usd: 5 }))
    expect(res.status).toBe(403)
    expect((await res.json()).denied).toEqual(["openai"])
  })

  it("403 when the agent isn't on the credential's allow-list", async () => {
    dbMock.credentialVault.findMany.mockResolvedValue([{ ...OPENAI_CRED, allowedAgentIds: ["someone_else"] }])
    expect((await issueExec(req({ scope: ["openai"], budget_usd: 5 }))).status).toBe(403)
  })

  it("403 when the agent's clearance is below the credential's minClearance", async () => {
    dbMock.credentialVault.findMany.mockResolvedValue([{ ...OPENAI_CRED, minClearance: 4 }])
    expect((await issueExec(req({ scope: ["openai"], budget_usd: 5 }))).status).toBe(403)
  })
})

describe("exec — issuance (SEC-13, AUTHZ-JTI)", () => {
  it("issues a token whose jti IS the persisted ExecutionToken id, with no-store on the response", async () => {
    const res = await issueExec(req({ scope: ["openai"], budget_usd: 5, ttl_seconds: 900 }))
    expect(res.status).toBe(200)
    // SEC-13: the JWT is a bearer secret — it must never sit in a cache.
    expect(res.headers.get("cache-control")).toBe("no-store")

    const body = await res.json()
    expect(body.jwt).toBeTruthy()
    expect(body.jti).toBeTruthy()
    expect(body.clearance).toBe(2) // copied from the agent's clearance row

    // AUTHZ-JTI: issue and inject can never disagree — the row id is the jti.
    const created = dbMock.executionToken.create.mock.calls[0][0].data
    expect(created.id).toBe(body.jti)
    expect(created).toMatchObject({ agentId: AID, walletId: WID, scope: ["openai"], budgetUsd: 5, clearance: 2 })
  })

  it("defaults clearance to 1 when the agent has no clearance row", async () => {
    dbMock.agentClearance.findUnique.mockResolvedValue(null)
    const res = await issueExec(req({ scope: ["openai"], budget_usd: 5 }))
    expect(res.status).toBe(200)
    expect((await res.json()).clearance).toBe(1)
  })
})
