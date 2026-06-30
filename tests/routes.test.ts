import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Route-handler integration tests with a mocked Prisma client. Covers the auth
// gates (the #1 untested risk) and the behavior of today's new routes (rotate,
// revoke, sub-account). Concurrency/atomicity is a separate DB-backed test.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    agentClearance: { upsert: vi.fn() },
    webhook: { findUnique: vi.fn(), update: vi.fn() },
    credentialVault: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: vi.fn(async () => ({ ok: true, limit: 15 })) }
})

import { POST as rotate } from "../app/api/v1/agents/rotate/route"
import { PATCH as patchAgent } from "../app/api/v1/agents/route"
import { POST as createWallet, PATCH as patchWallet } from "../app/api/v1/wallets/route"
import { GET as walletTree } from "../app/api/v1/wallets/tree/route"
import { PATCH as patchWebhook } from "../app/api/v1/webhooks/route"
import { DELETE as retireCredential } from "../app/api/v1/credentials/vault/route"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AID = "agent_1"

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}
const mgmt = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  // Default: a root wallet whose management key hashes to SK.
  dbMock.wallet.findUnique.mockResolvedValue({ id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" })
})

describe("auth gates — management plane refuses without a valid key", () => {
  it("rotate → 401 with no management key", async () => {
    expect((await rotate(req("POST", "/api/v1/agents/rotate", { body: { wallet_id: WID, agent_id: AID } }))).status).toBe(401)
  })
  it("rotate → 401 with a wrong management key", async () => {
    expect((await rotate(req("POST", "/api/v1/agents/rotate", { headers: { "x-mgmt-key": "sk_wrong" }, body: { wallet_id: WID, agent_id: AID } }))).status).toBe(401)
  })
  it("agents PATCH → 401 with no management key", async () => {
    expect((await patchAgent(req("PATCH", "/api/v1/agents", { body: { wallet_id: WID, agent_id: AID, active: false } }))).status).toBe(401)
  })
  it("wallets/tree → 401 with no management key", async () => {
    expect((await walletTree(req("GET", "/api/v1/wallets/tree?wallet_id=" + WID))).status).toBe(401)
  })
  it("sub-account create → 401 when parent_id is given but no management key", async () => {
    expect((await createWallet(req("POST", "/api/v1/wallets", { body: { name: "Clinic", owner_email: "c@x.com", parent_id: WID } }))).status).toBe(401)
  })
})

describe("agent key rotation (SEC-6)", () => {
  it("issues a fresh key and persists its hash; old key is overwritten", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ id: AID, walletId: WID })
    dbMock.agent.update.mockResolvedValue({})
    const res = await rotate(req("POST", "/api/v1/agents/rotate", { headers: mgmt, body: { wallet_id: WID, agent_id: AID } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.api_key).toMatch(/^pxy_/)
    const arg = dbMock.agent.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: AID })
    expect(arg.data.apiKeyHash).toBe(hashApiKey(body.api_key)) // the returned key's hash is what's stored
  })

  it("404 when the agent is not in the authenticated wallet", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ id: AID, walletId: "someone_else" })
    expect((await rotate(req("POST", "/api/v1/agents/rotate", { headers: mgmt, body: { wallet_id: WID, agent_id: AID } }))).status).toBe(404)
  })
})

describe("agent revocation (PATCH active:false)", () => {
  it("sets isActive on the agent", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ id: AID, walletId: WID })
    dbMock.agent.update.mockResolvedValue({ id: AID, name: "a", isActive: false, dailyTokenBudgetUsd: null, dailySpendBudgetUsd: null, perTransactionMaxUsd: null, escalateOverUsd: null })
    const res = await patchAgent(req("PATCH", "/api/v1/agents", { headers: mgmt, body: { wallet_id: WID, agent_id: AID, active: false } }))
    expect(res.status).toBe(200)
    expect(dbMock.agent.update.mock.calls[0][0].data.isActive).toBe(false)
  })
})

describe("wallet creation — root vs sub-account", () => {
  it("root signup needs no auth and creates a root (parentId null)", async () => {
    dbMock.wallet.create.mockResolvedValue({ id: "root1", name: "Acme", ownerEmail: "a@x.com", parentId: null, createdAt: new Date() })
    const res = await createWallet(req("POST", "/api/v1/wallets", { body: { name: "Acme", owner_email: "a@x.com" } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.management_key).toMatch(/^sk_/)
    expect(dbMock.wallet.create.mock.calls[0][0].data.parentId).toBeNull()
  })

  it("sub-account with parent mgmt key nests under the parent (parentId set)", async () => {
    dbMock.wallet.create.mockResolvedValue({ id: "child1", name: "Clinic", ownerEmail: "c@x.com", parentId: WID, createdAt: new Date() })
    const res = await createWallet(req("POST", "/api/v1/wallets", { headers: mgmt, body: { name: "Clinic", owner_email: "c@x.com", parent_id: WID } }))
    expect(res.status).toBe(201)
    expect((await res.json()).parent_id).toBe(WID)
    expect(dbMock.wallet.create.mock.calls[0][0].data.parentId).toBe(WID)
  })
})

describe("wallet settings (PATCH /wallets)", () => {
  it("renames the wallet", async () => {
    dbMock.wallet.update.mockResolvedValue({ id: WID, name: "Renamed", ownerEmail: "a@x.com" })
    const res = await patchWallet(req("PATCH", "/api/v1/wallets", { headers: mgmt, body: { wallet_id: WID, name: "Renamed" } }))
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe("Renamed")
    expect(dbMock.wallet.update.mock.calls[0][0].data).toEqual({ name: "Renamed" })
  })
  it("401 without a management key", async () => {
    expect((await patchWallet(req("PATCH", "/api/v1/wallets", { body: { wallet_id: WID, name: "x" } }))).status).toBe(401)
  })
  it("400 when nothing to update", async () => {
    expect((await patchWallet(req("PATCH", "/api/v1/wallets", { headers: mgmt, body: { wallet_id: WID } }))).status).toBe(400)
  })
})

describe("webhook edit (PATCH /webhooks)", () => {
  it("toggles isActive without re-creating the secret", async () => {
    dbMock.webhook.findUnique.mockResolvedValue({ id: "wh1", walletId: WID })
    dbMock.webhook.update.mockResolvedValue({ id: "wh1", url: "https://x.com/h", events: ["*"], isActive: false, createdAt: new Date() })
    const res = await patchWebhook(req("PATCH", "/api/v1/webhooks", { headers: mgmt, body: { wallet_id: WID, id: "wh1", active: false } }))
    expect(res.status).toBe(200)
    expect(dbMock.webhook.update.mock.calls[0][0].data.isActive).toBe(false)
  })
  it("404 when the webhook is not in the wallet", async () => {
    dbMock.webhook.findUnique.mockResolvedValue({ id: "wh1", walletId: "other" })
    expect((await patchWebhook(req("PATCH", "/api/v1/webhooks", { headers: mgmt, body: { wallet_id: WID, id: "wh1", active: false } }))).status).toBe(404)
  })
})

describe("credential retire (DELETE /credentials/vault)", () => {
  it("soft-retires (sets revokedAt) instead of hard-deleting", async () => {
    dbMock.credentialVault.findUnique.mockResolvedValue({ id: "cr1", walletId: WID })
    dbMock.credentialVault.update.mockResolvedValue({ id: "cr1", revokedAt: new Date() })
    const res = await retireCredential(req("DELETE", "/api/v1/credentials/vault?wallet_id=" + WID + "&id=cr1", { headers: mgmt }))
    expect(res.status).toBe(200)
    expect((await res.json()).retired).toBe("cr1")
    expect(dbMock.credentialVault.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date)
  })
  it("404 when the credential is not in the wallet", async () => {
    dbMock.credentialVault.findUnique.mockResolvedValue({ id: "cr1", walletId: "other" })
    expect((await retireCredential(req("DELETE", "/api/v1/credentials/vault?wallet_id=" + WID + "&id=cr1", { headers: mgmt }))).status).toBe(404)
  })
})
