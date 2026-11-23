// The connect / disconnect server actions hold an admin key to someone's AI
// account. These tests pin the security properties: admin floor, a rejected
// key is never stored, the key is encrypted under a non-injectable label and
// never echoed, and disconnect hard-deletes it.

import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => {
  const tx = {
    credentialVault: { deleteMany: vi.fn(), create: vi.fn() },
    usageFact: { deleteMany: vi.fn(), groupBy: vi.fn() },
    usageAlert: { deleteMany: vi.fn() },
  }
  return {
    tx,
    db: { usageConnection: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() } },
    member: vi.fn(),
    encrypt: vi.fn(),
    probe: vi.fn(),
    sync: vi.fn(),
    revalidate: vi.fn(),
  }
})
vi.mock("@/lib/db", () => ({ db: m.db }))
vi.mock("@/lib/rls", () => ({ withTenant: (_w: string, fn: (tx: unknown) => unknown) => fn(m.tx) }))
vi.mock("@/lib/session", () => ({ getSessionMember: m.member }))
vi.mock("@/lib/credentialCrypto", () => ({ encryptCredentialEnvelope: m.encrypt }))
vi.mock("@/lib/connectors/adapters", () => ({ adapterFor: (id: string) => (id === "cursor" || id === "anthropic" || id === "openai" ? { probe: m.probe } : undefined) }))
vi.mock("@/lib/connectors/sync", () => ({ syncConnection: m.sync }))
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }))

import { connectUsageToolAction, disconnectUsageToolAction, syncUsageToolNowAction } from "../app/dashboard/ai-spend/actions"
import { ConnectorError } from "../lib/connectors/facts"
import { isReservedVaultLabel } from "../lib/providers"
import { usd } from "../lib/connectors/money"

const KEY = "crsr_0123456789abcdef0123456789abcdef"
const idle = { ok: false, message: "" }
const form = (entries: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}
const admin = { wallet: { id: "w_1", ownerEmail: "owner@example.test" }, role: "admin", actor: { type: "user", email: "admin@example.test" } }

beforeEach(() => {
  vi.resetAllMocks()
  m.member.mockResolvedValue(admin)
  m.probe.mockResolvedValue({ events: [], httpCalls: 1 })
  m.encrypt.mockResolvedValue({ blob: "ciphertext", keyId: "wk_1" })
  m.db.usageConnection.upsert.mockResolvedValue({ id: "conn_1" })
  m.tx.credentialVault.create.mockResolvedValue({ id: "cred_1" })
  m.sync.mockResolvedValue({ ok: true, factsWritten: 3, alertsRaised: 0 })
  m.tx.usageFact.groupBy.mockResolvedValue([{ rawIdentity: "a", _sum: { costNanos: usd(100) } }, { rawIdentity: "b", _sum: { costNanos: usd(42) } }])
})

describe("connectUsageToolAction", () => {
  it("denies viewers and anonymous visitors before touching anything", async () => {
    for (const member of [null, { ...admin, role: "viewer" }]) {
      m.member.mockResolvedValue(member)
      expect((await connectUsageToolAction(idle, form({ provider: "cursor", api_key: KEY }))).ok).toBe(false)
    }
    expect(m.probe).not.toHaveBeenCalled()
    expect(m.encrypt).not.toHaveBeenCalled()
  })

  it("rejects unknown tools and things that are not a key", async () => {
    expect((await connectUsageToolAction(idle, form({ provider: "gemini", api_key: KEY }))).message).toBe("Unknown tool.")
    for (const bad of ["short", "has a space in the middle of the key value", ""]) {
      expect((await connectUsageToolAction(idle, form({ provider: "cursor", api_key: bad }))).ok).toBe(false)
    }
    expect(m.probe).not.toHaveBeenCalled()
  })

  it("never stores a key the provider rejected", async () => {
    m.probe.mockRejectedValue(new ConnectorError("bad_key", "Cursor rejected this API key."))
    expect(await connectUsageToolAction(idle, form({ provider: "cursor", api_key: KEY }))).toEqual({ ok: false, message: "Cursor rejected this API key." })
    m.probe.mockRejectedValue(new Error(`boom ${KEY}`))
    const crashed = await connectUsageToolAction(idle, form({ provider: "cursor", api_key: KEY }))
    expect(crashed.message).not.toContain(KEY)
    expect(m.encrypt).not.toHaveBeenCalled()
    expect(m.db.usageConnection.upsert).not.toHaveBeenCalled()
    expect(m.tx.credentialVault.create).not.toHaveBeenCalled()
  })

  it("encrypts under a reserved, connection-bound, non-injectable label, then pulls", async () => {
    const result = await connectUsageToolAction(idle, form({ provider: "cursor", api_key: `  ${KEY}  ` }))
    expect(result).toEqual({ ok: true, message: "Connected. Last 7 days: $142.00 across 2 people." })
    expect(m.probe.mock.calls[0][0]).toBe(KEY)
    expect(m.encrypt).toHaveBeenCalledWith(KEY, "w_1", "usage:cursor:conn_1")
    expect(isReservedVaultLabel("usage:cursor:conn_1")).toBe(true)
    // The old ciphertext is deleted, not soft-retired.
    expect(m.tx.credentialVault.deleteMany).toHaveBeenCalledWith({ where: { walletId: "w_1", label: "usage:cursor:conn_1" } })
    const stored = m.tx.credentialVault.create.mock.calls[0][0].data
    expect(stored).toMatchObject({ walletId: "w_1", label: "usage:cursor:conn_1", encryptedValue: "ciphertext", keyId: "wk_1", minClearance: 5 })
    expect(stored.allowedAgentIds).toEqual(["gateway-internal-only"])
    expect(JSON.stringify(stored)).not.toContain(KEY)
    expect(m.db.usageConnection.update).toHaveBeenCalledWith({ where: { id: "conn_1" }, data: { credentialId: "cred_1" } })
    expect(m.sync).toHaveBeenCalledWith("conn_1", expect.objectContaining({ trigger: "connect_test", actorEmail: "admin@example.test" }))
    expect(JSON.stringify(result)).not.toContain(KEY)
    // Re-keying resets the watermark so history is re-read under the same row.
    expect(m.db.usageConnection.upsert.mock.calls[0][0].update).toMatchObject({ syncedThrough: null, status: "active", disconnectedAt: null })
  })

  it("attributes a legacy key session to the wallet owner, and says so when the first pull fails", async () => {
    m.member.mockResolvedValue({ ...admin, role: "owner", actor: { type: "key" } })
    m.sync.mockResolvedValue({ ok: false, code: "rate_limited", message: "Cursor is rate limiting this team." })
    m.tx.usageFact.groupBy.mockResolvedValue([{ rawIdentity: "a", _sum: { costNanos: null } }])
    const result = await connectUsageToolAction(idle, form({ provider: "cursor", api_key: KEY }))
    expect(result).toEqual({ ok: false, message: "The key was accepted and saved, but the first pull failed: Cursor is rate limiting this team." })
    expect(m.sync.mock.calls[0][1].actorEmail).toBe("owner@example.test")
    m.sync.mockResolvedValue({ ok: true, factsWritten: 0, alertsRaised: 0 })
    expect((await connectUsageToolAction(idle, form({ provider: "cursor", api_key: KEY }))).message).toBe("Connected. Last 7 days: $0.00 across 1 person.")
  })

  it("connects Claude through the same path, with its own label and error wording", async () => {
    const result = await connectUsageToolAction(idle, form({ provider: "anthropic", api_key: KEY }))
    expect(result.ok).toBe(true)
    expect(m.encrypt).toHaveBeenCalledWith(KEY, "w_1", "usage:anthropic:conn_1")
    expect(m.db.usageConnection.upsert.mock.calls[0][0].where).toEqual({ walletId_provider: { walletId: "w_1", provider: "anthropic" } })
    m.probe.mockRejectedValue(new Error("network"))
    expect((await connectUsageToolAction(idle, form({ provider: "anthropic", api_key: KEY }))).message).toBe("Could not reach Claude to check the key. Try again.")
  })
})

describe("disconnectUsageToolAction", () => {
  const existing = { id: "conn_1", walletId: "w_1", provider: "cursor" }

  it("is a no-op for non-admins, bad input, and another wallet's connection", async () => {
    m.member.mockResolvedValue({ ...admin, role: "viewer" })
    await disconnectUsageToolAction(form({ connection_id: "conn_1" }))
    m.member.mockResolvedValue(admin)
    await disconnectUsageToolAction(form({}))
    m.db.usageConnection.findFirst.mockResolvedValue(null)
    await disconnectUsageToolAction(form({ connection_id: "someone-elses" }))
    expect(m.db.usageConnection.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: "someone-elses", walletId: "w_1" } })
    expect(m.tx.credentialVault.deleteMany).not.toHaveBeenCalled()
    expect(m.db.usageConnection.update).not.toHaveBeenCalled()
  })

  it("hard-deletes the stored key and keeps history by default", async () => {
    m.db.usageConnection.findFirst.mockResolvedValue(existing)
    await disconnectUsageToolAction(form({ connection_id: "conn_1" }))
    expect(m.tx.credentialVault.deleteMany).toHaveBeenCalledWith({ where: { walletId: "w_1", label: "usage:cursor:conn_1" } })
    expect(m.tx.usageFact.deleteMany).not.toHaveBeenCalled()
    expect(m.db.usageConnection.update.mock.calls[0][0].data).toMatchObject({ status: "disconnected", credentialId: null })
  })

  it("deletes usage data too when asked", async () => {
    m.db.usageConnection.findFirst.mockResolvedValue(existing)
    await disconnectUsageToolAction(form({ connection_id: "conn_1", delete_data: "on" }))
    expect(m.tx.usageFact.deleteMany).toHaveBeenCalledWith({ where: { walletId: "w_1", connectionId: "conn_1" } })
    expect(m.tx.usageAlert.deleteMany).toHaveBeenCalledWith({ where: { walletId: "w_1", connectionId: "conn_1" } })
  })
})

describe("syncUsageToolNowAction", () => {
  it("is admin-only, wallet-scoped, and refuses to hammer an hourly API", async () => {
    m.member.mockResolvedValue(null)
    expect((await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).ok).toBe(false)
    m.member.mockResolvedValue(admin)
    expect((await syncUsageToolNowAction(idle, form({}))).message).toBe("Unknown connection.")
    m.db.usageConnection.findFirst.mockResolvedValue(null)
    expect((await syncUsageToolNowAction(idle, form({ connection_id: "x" }))).message).toBe("Unknown connection.")
    expect(m.db.usageConnection.findFirst.mock.calls[0][0].where).toMatchObject({ id: "x", walletId: "w_1" })
    m.db.usageConnection.findFirst.mockResolvedValue({ id: "conn_1", lastAttemptAt: new Date(Date.now() - 60_000) })
    expect((await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).message).toMatch(/hourly/)
    expect(m.sync).not.toHaveBeenCalled()
  })

  it("pulls and reports the outcome", async () => {
    m.db.usageConnection.findFirst.mockResolvedValue({ id: "conn_1", lastAttemptAt: new Date(Date.now() - 3_600_000) })
    expect(await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).toEqual({ ok: true, message: "Pulled. No new alerts." })
    m.sync.mockResolvedValue({ ok: true, alertsRaised: 1 })
    expect((await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).message).toBe("Pulled. 1 new alert.")
    m.sync.mockResolvedValue({ ok: true, alertsRaised: 2 })
    expect((await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).message).toBe("Pulled. 2 new alerts.")
    m.sync.mockResolvedValue({ ok: false, code: "bad_key", message: "Cursor rejected this API key." })
    expect(await syncUsageToolNowAction(idle, form({ connection_id: "conn_1" }))).toEqual({ ok: false, message: "Cursor rejected this API key." })
    expect(m.sync).toHaveBeenCalledWith("conn_1", { trigger: "manual", actorEmail: "admin@example.test" })
  })
})
