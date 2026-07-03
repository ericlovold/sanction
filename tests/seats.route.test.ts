import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Seat wallets slice 1: a seat is an Agent you can hand around. Proves the
// three seat invariants — expiry fails closed on every auth plane, rotation
// passes the seat (holder moves, history and config stay), and batch creation
// stamps one template across N seats with each key shown exactly once.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    agentClearance: { create: vi.fn() },
    wallet: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/gateway", async (orig) => {
  const mod = await orig<typeof import("@/lib/gateway")>()
  return { ...mod, isBudgetExhausted: vi.fn(async () => ({ exhausted: false, spent: 0, budget: 10 })) }
})

import { authenticateAgent } from "../lib/auth"
import { POST as gateway } from "../app/api/gateway/[provider]/[...path]/route"
import { POST as rotate } from "../app/api/v1/agents/rotate/route"
import { POST as batchCreate } from "../app/api/v1/agents/batch/route"
import { POST as createAgent } from "../app/api/v1/agents/route"

const KEY = "pxy_testagentkey"
const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AID = "agent_1"

const AGENT = {
  id: AID,
  walletId: WID,
  name: "eng-1",
  holder: "Pete",
  isActive: true,
  lastUsedAt: new Date(),
  expiresAt: null as Date | null,
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
const mgmtH = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({ ...AGENT })
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

describe("seat expiry — the key fails closed everywhere past expiresAt", () => {
  const EXPIRED = { ...AGENT, expiresAt: new Date(Date.now() - 60_000) }
  const LIVE = { ...AGENT, expiresAt: new Date(Date.now() + 60_000) }

  it("data plane: authenticateAgent refuses an expired seat", async () => {
    dbMock.agent.findUnique.mockResolvedValue(EXPIRED)
    const { agent, error } = await authenticateAgent(req("POST", "/x", { headers: { "x-api-key": KEY } }))
    expect(agent).toBeNull()
    expect(error).toBe("Agent key expired")
  })

  it("data plane: a future expiry still authenticates", async () => {
    dbMock.agent.findUnique.mockResolvedValue(LIVE)
    const { agent } = await authenticateAgent(req("POST", "/x", { headers: { "x-api-key": KEY } }))
    expect(agent?.id).toBe(AID)
  })

  it("gateway: an expired seat gets 401 before any provider call", async () => {
    dbMock.agent.findUnique.mockResolvedValue(EXPIRED)
    global.fetch = vi.fn() as never
    const res = await gateway(
      req("POST", "/api/gateway/anthropic/v1/messages", { headers: { "x-sanction-key": KEY }, body: {} }),
      { params: Promise.resolve({ provider: "anthropic", path: ["v1", "messages"] }) },
    )
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("passing the seat — rotate moves the holder, keeps everything else", () => {
  it("rotates the key and sets the new holder in one motion", async () => {
    dbMock.agent.update.mockResolvedValue({ ...AGENT, holder: "Priya" })
    const res = await rotate(req("POST", "/api/v1/agents/rotate", { headers: mgmtH, body: { wallet_id: WID, agent_id: AID, holder: "Priya" } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.holder).toBe("Priya")
    expect(body.api_key).toMatch(/^pxy_/)
    const data = dbMock.agent.update.mock.calls[0][0].data
    expect(data.holder).toBe("Priya")
    expect(data.apiKeyHash).toBe(hashApiKey(body.api_key)) // new key, same seat
  })

  it("rotation without a holder change leaves the holder untouched", async () => {
    await rotate(req("POST", "/api/v1/agents/rotate", { headers: mgmtH, body: { wallet_id: WID, agent_id: AID } }))
    expect(dbMock.agent.update.mock.calls[0][0].data.holder).toBeUndefined()
  })
})

describe("single seat creation — holder + expiry at birth", () => {
  it("creates a seat with holder and auto-shutoff date", async () => {
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString()
    dbMock.agent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "agent_c1", createdAt: new Date(), ...data }))
    const res = await createAgent(
      req("POST", "/api/v1/agents", { headers: mgmtH, body: { wallet_id: WID, name: "contractor-1", holder: "Sam", expires_at: until } }),
    )
    expect(res.status).toBe(201)
    const created = dbMock.agent.create.mock.calls[0][0].data
    expect(created.holder).toBe("Sam")
    expect((created.expiresAt as Date).toISOString()).toBe(until)
  })
})

describe("batch creation — one template stamped across N seats", () => {
  beforeEach(() => {
    let n = 0
    dbMock.agent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `agent_b${++n}`, createdAt: new Date(), ...data }))
    dbMock.agentClearance.create.mockResolvedValue({})
  })

  it("mints prefix-numbered seats with template budgets in cents and expiry", async () => {
    const until = new Date(Date.now() + 90 * 86_400_000).toISOString()
    const res = await batchCreate(
      req("POST", "/api/v1/agents/batch", {
        headers: mgmtH,
        body: { wallet_id: WID, name_prefix: "eng", count: 5, template: { daily_spend_budget_usd: 20, clearance: 2, expires_at: until } },
      }),
    )
    expect(res.status).toBe(201)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.seats).toHaveLength(5)
    expect(body.seats.map((s: { name: string }) => s.name)).toEqual(["eng-1", "eng-2", "eng-3", "eng-4", "eng-5"])
    // every key distinct, shown once, only its hash persisted
    const keys = body.seats.map((s: { api_key: string }) => s.api_key)
    expect(new Set(keys).size).toBe(5)
    const firstStored = dbMock.agent.create.mock.calls[0][0].data
    expect(firstStored.apiKeyHash).toBe(hashApiKey(keys[0]))
    expect(firstStored.dailySpendBudgetUsd).toBe(2000) // $20 → cents
    // clearance stamped per seat
    expect(dbMock.agentClearance.create).toHaveBeenCalledTimes(5)
  })

  it("accepts an explicit roster with holders", async () => {
    const res = await batchCreate(
      req("POST", "/api/v1/agents/batch", {
        headers: mgmtH,
        body: { wallet_id: WID, seats: [{ name: "mkt-1", holder: "Ana" }, { name: "mkt-2", holder: "Ben" }] },
      }),
    )
    const body = await res.json()
    expect(body.seats.map((s: { holder: string }) => s.holder)).toEqual(["Ana", "Ben"])
  })

  it("400 without a roster or prefix+count; 401 without the owner key; caps at 50", async () => {
    expect((await batchCreate(req("POST", "/api/v1/agents/batch", { headers: mgmtH, body: { wallet_id: WID } }))).status).toBe(400)
    expect((await batchCreate(req("POST", "/api/v1/agents/batch", { headers: mgmtH, body: { wallet_id: WID, name_prefix: "x", count: 51 } }))).status).toBe(400)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await batchCreate(req("POST", "/api/v1/agents/batch", { body: { wallet_id: WID, name_prefix: "x", count: 2 } }))).status).toBe(401)
  })
})
