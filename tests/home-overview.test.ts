import { beforeEach, describe, expect, it, vi } from "vitest"

const { vault, models, usage, tenant } = vi.hoisted(() => ({
  vault: vi.fn(), models: vi.fn(), usage: vi.fn(), tenant: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: { tokenLog: { groupBy: models } } }))
vi.mock("@/lib/rls", () => ({ withTenant: tenant }))
vi.mock("@/lib/usageView", () => ({ usageView: usage }))
import { homeOverview, summarizeHomeTools } from "@/lib/homeOverview"

const now = new Date("2026-11-24T12:00:00Z")
const emptyUsage = { sessions: [], connections: [], truncated: false }
const session = {
  key: "one", sessionId: "one", source: "claude-code", seat: "Seat", lastEvent: now,
  events: 3, modelCalls: 2, tokensIn: 100, tokensOut: 20, estimatedCost: 0.25,
  unpricedCalls: 1, unmeteredCalls: 1,
}

beforeEach(() => {
  vi.resetAllMocks()
  tenant.mockImplementation((_id, fn) => fn({ credentialVault: { findMany: vault } }))
  vault.mockResolvedValue([])
  models.mockResolvedValue([])
  usage.mockResolvedValue(emptyUsage)
})

describe("Home overview data", () => {
  it("keeps missing provider records and absent tool usage unknown", async () => {
    const result = await homeOverview("wallet-a", now)
    expect(result.providers.every(p => p.spend === null && p.keyStatus === "No stored key")).toBe(true)
    expect(result.tools.every(t => t.sessions === null && t.tokens === null && t.estimatedCost === null)).toBe(true)
  })

  it("scopes vault, model logs and observations to the current wallet", async () => {
    await homeOverview("wallet-a", now)
    expect(tenant).toHaveBeenCalledWith("wallet-a", expect.any(Function))
    expect(vault).toHaveBeenCalledWith(expect.objectContaining({ where: {
      walletId: "wallet-a", label: { startsWith: "provider:" }, revokedAt: null,
    } }))
    expect(models).toHaveBeenCalledWith(expect.objectContaining({ where: {
      agent: { walletId: "wallet-a" }, createdAt: { gte: new Date("2026-11-01T00:00:00Z"), lte: now },
    } }))
    expect(usage).toHaveBeenCalledWith("wallet-a", now)
  })

  it("separates stored keys, actual zero-cost records, unattributed models and observation estimates", async () => {
    vault.mockResolvedValue([{ label: "provider:anthropic" }])
    models.mockResolvedValue([
      { model: "claude-sonnet", _sum: { costUsd: 0 }, _count: { _all: 1 } },
      { model: "unrecognized", _sum: { costUsd: 2 }, _count: { _all: 1 } },
    ])
    usage.mockResolvedValue({ ...emptyUsage, sessions: [session] })
    const result = await homeOverview("wallet-a", now)
    expect(result.providers[0]).toMatchObject({ keyStatus: "Key stored", spend: 0 })
    expect(result.providers[1].spend).toBeNull()
    expect(result.otherSpend).toBe(2)
    expect(result.tools[0].estimatedCost).toBe(0.25)
  })

  it("shows data-source failures as unavailable, not missing keys or zero spend", async () => {
    vault.mockRejectedValue(new Error("offline"))
    models.mockRejectedValue(new Error("offline"))
    usage.mockRejectedValue(new Error("offline"))
    const result = await homeOverview("wallet-a", now)
    expect(result.spendUnavailable).toBe(true)
    expect(result.providers[0].keyStatus).toBe("Key status unavailable")
    expect(result.tools[0].status).toBe("Reporting unavailable")
  })
})

describe("Home developer tool summaries", () => {
  it("marks mixed priced/unpriced and metered/unmetered calls partial", () => {
    const result = summarizeHomeTools({ ...emptyUsage, sessions: [session] })[0]
    expect(result).toMatchObject({ tokens: 120, estimatedCost: 0.25, tokensPartial: true, estimatePartial: true })
  })

  it("keeps entirely unpriced and unmetered usage unavailable", () => {
    const result = summarizeHomeTools({ ...emptyUsage, sessions: [{ ...session, unpricedCalls: 2, unmeteredCalls: 2 }] })[0]
    expect(result.tokens).toBeNull()
    expect(result.estimatedCost).toBeNull()
  })

  it("marks a truncated window partial even when included calls are fully priced", () => {
    const result = summarizeHomeTools({ ...emptyUsage, truncated: true, sessions: [{ ...session, unpricedCalls: 0, unmeteredCalls: 0 }] })[0]
    expect(result).toMatchObject({ truncated: true, tokensPartial: true, estimatePartial: true })
  })

  it("preserves source delivery status without inventing connection health", () => {
    const result = summarizeHomeTools({ ...emptyUsage, connections: [{ source: "codex", receivedAt: now, occurredAt: now, status: "No recent delivery" }] })[1]
    expect(result).toMatchObject({ status: "No recent delivery", receivedAt: now, estimatedCost: null })
  })
})
