import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// The three auth boundaries (the highest-value untested code): the management
// plane (authenticateOwner), the agent data plane (authenticateAgent), and the
// dashboard session (getSessionWallet). All mock the DB + cookies.
const { dbMock, cookieStore } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  },
  cookieStore: { get: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }))

import { authenticateOwner } from "../lib/ownerAuth"
import { authenticateAgent } from "../lib/auth"
import { getSessionWallet, SESSION_COOKIE } from "../lib/session"

const SK = "sk_ownertestkey"
const PXY = "pxy_agenttestkey"
const WID = "wallet_1"

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://t.local/x", { headers })
}

beforeEach(() => vi.clearAllMocks())

describe("authenticateOwner — management plane", () => {
  it("400 when walletId is missing", async () => {
    expect((await authenticateOwner(req({ "x-mgmt-key": SK }), "")).status).toBe(400)
  })
  it("401 when no management key is supplied", async () => {
    expect((await authenticateOwner(req(), WID)).status).toBe(401)
  })
  it("404 when the wallet does not exist", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await authenticateOwner(req({ "x-mgmt-key": SK }), WID)).status).toBe(404)
  })
  it("403 fail-closed when the wallet has no management key set", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ id: WID, mgmtKeyHash: null })
    expect((await authenticateOwner(req({ "x-mgmt-key": SK }), WID)).status).toBe(403)
  })
  it("401 on a wrong key (constant-time compare)", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ id: WID, mgmtKeyHash: hashApiKey(SK) })
    expect((await authenticateOwner(req({ "x-mgmt-key": "sk_wrong" }), WID)).status).toBe(401)
  })
  it("200 + wallet on a valid x-mgmt-key", async () => {
    const wallet = { id: WID, mgmtKeyHash: hashApiKey(SK) }
    dbMock.wallet.findUnique.mockResolvedValue(wallet)
    const r = await authenticateOwner(req({ "x-mgmt-key": SK }), WID)
    expect(r.status).toBe(200)
    expect(r.wallet).toBe(wallet)
  })
  it("also accepts Authorization: Bearer sk_...", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ id: WID, mgmtKeyHash: hashApiKey(SK) })
    expect((await authenticateOwner(req({ authorization: `Bearer ${SK}` }), WID)).status).toBe(200)
  })
})

describe("authenticateAgent — data plane", () => {
  it("rejects a missing x-api-key", async () => {
    const r = await authenticateAgent(req())
    expect(r.agent).toBeNull()
    expect(r.error).toMatch(/x-api-key/)
  })
  it("rejects an unknown key", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)
    const r = await authenticateAgent(req({ "x-api-key": PXY }))
    expect(r.agent).toBeNull()
  })
  it("rejects an inactive agent (revoked key)", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ id: "a1", isActive: false, lastUsedAt: new Date() })
    const r = await authenticateAgent(req({ "x-api-key": PXY }))
    expect(r.agent).toBeNull()
    expect(r.error).toMatch(/inactive/)
  })
  it("looks the agent up by the HASH of the key, never the raw key", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ id: "a1", isActive: true, walletId: WID, lastUsedAt: new Date(), wallet: { policy: {} } })
    const r = await authenticateAgent(req({ "x-api-key": PXY }))
    expect(r.agent).toBeTruthy()
    expect(dbMock.agent.findUnique.mock.calls[0][0].where).toEqual({ apiKeyHash: hashApiKey(PXY) })
  })
})

describe("getSessionWallet — dashboard session", () => {
  it("returns null with no session cookie", async () => {
    cookieStore.get.mockReturnValue(undefined)
    expect(await getSessionWallet()).toBeNull()
  })
  it("resolves the wallet by the HASH of the cookie value", async () => {
    cookieStore.get.mockReturnValue({ value: SK })
    const wallet = { id: WID }
    dbMock.wallet.findUnique.mockResolvedValue(wallet)
    expect(await getSessionWallet()).toBe(wallet)
    expect(cookieStore.get.mock.calls[0][0]).toBe(SESSION_COOKIE)
    expect(dbMock.wallet.findUnique.mock.calls[0][0].where).toEqual({ mgmtKeyHash: hashApiKey(SK) })
  })
})
