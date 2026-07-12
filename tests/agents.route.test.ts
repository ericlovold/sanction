import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Agent registration + listing (management plane). The key contract: the raw
// pxy_ key is returned exactly once at creation and only its hash is persisted;
// the listing never exposes more than the display prefix.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    wallet: { findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))

import { POST as createAgent, GET as listAgents } from "../app/api/v1/agents/route"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}
const mgmtH = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
})

describe("agents route — registration", () => {
  it("400 on a missing/oversized name", async () => {
    expect((await createAgent(req("POST", "/api/v1/agents", { headers: mgmtH, body: { wallet_id: WID } }))).status).toBe(400)
    expect((await createAgent(req("POST", "/api/v1/agents", { headers: mgmtH, body: { wallet_id: WID, name: "x".repeat(65) } }))).status).toBe(400)
  })

  it("401 without the owner key — agent creation is owner-only", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await createAgent(req("POST", "/api/v1/agents", { body: { wallet_id: WID, name: "tenet" } }))).status).toBe(401)
    expect(dbMock.agent.create).not.toHaveBeenCalled()
  })

  it("creates the agent: raw key returned once, only its hash stored", async () => {
    dbMock.agent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "agent_1", createdAt: new Date(), ...data }))
    const res = await createAgent(req("POST", "/api/v1/agents", { headers: mgmtH, body: { wallet_id: WID, name: "tenet" } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.api_key).toMatch(/^pxy_/)
    const stored = dbMock.agent.create.mock.calls[0][0].data
    expect(stored.apiKeyHash).toBe(hashApiKey(body.api_key))
    expect(JSON.stringify(stored)).not.toContain(body.api_key) // the raw key is never persisted
  })
})

describe("agents route — listing", () => {
  it("400 without wallet_id, 401 with a wrong key", async () => {
    expect((await listAgents(req("GET", "/api/v1/agents"))).status).toBe(400)
    expect((await listAgents(req("GET", `/api/v1/agents?wallet_id=${WID}`, { headers: { "x-mgmt-key": "sk_wrong" } }))).status).toBe(401)
  })

  it("lists only display fields — prefixes, never hashes or keys", async () => {
    dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet", apiKeyPrefix: "pxy_test", isActive: true, createdAt: new Date(), walletId: WID, wallet: { name: "Acme" } }])
    const res = await listAgents(req("GET", `/api/v1/agents?wallet_id=${WID}`, { headers: mgmtH }))
    expect(res.status).toBe(200)
    const select = dbMock.agent.findMany.mock.calls[0][0].select
    expect(select.apiKeyHash).toBeUndefined()
    const listed = (await res.json()).agents[0]
    expect(listed.apiKeyPrefix).toBe("pxy_test")
    expect(listed.pool).toBe("Acme") // each seat carries its owning pool name
    expect(listed.wallet).toBeUndefined() // the raw relation is flattened away
  })
})
