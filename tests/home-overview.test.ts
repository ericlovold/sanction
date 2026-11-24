import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { vault, models, latest, events, tenant } = vi.hoisted(() => ({
  vault: vi.fn(), models: vi.fn(), latest: vi.fn(), events: vi.fn(), tenant: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: {
  tokenLog: { groupBy: models },
  usageObservation: { groupBy: latest, findMany: events },
} }))
vi.mock("@/lib/rls", () => ({ withTenant: tenant }))
import { HomeOverview } from "@/components/home-overview"
import { homeOverview } from "@/lib/homeOverview"

const now = new Date("2026-11-24T12:00:00Z")

beforeEach(() => {
  vi.resetAllMocks()
  tenant.mockImplementation((_id, fn) => fn({ credentialVault: { findMany: vault } }))
  vault.mockResolvedValue([])
  models.mockResolvedValue([])
  latest.mockResolvedValue([])
})

describe("Home overview data", () => {
  it("keeps missing provider records and absent tool deliveries distinct", async () => {
    const result = await homeOverview("wallet-a", now)
    expect(result.providers.every(p => p.spend === null && p.keyStatus === "No stored key")).toBe(true)
    expect(result.tools.map(t => [t.source, t.status])).toEqual([
      ["claude-code", "No events received"], ["codex", "No events received"],
    ])
  })

  it("scopes vault, model logs and delivery summaries to the current wallet without loading session events", async () => {
    await homeOverview("wallet-a", now)
    expect(tenant).toHaveBeenCalledWith("wallet-a", expect.any(Function))
    expect(vault).toHaveBeenCalledWith(expect.objectContaining({ where: {
      walletId: "wallet-a", label: { startsWith: "provider:" }, revokedAt: null,
    } }))
    expect(models).toHaveBeenCalledWith(expect.objectContaining({ where: {
      agent: { walletId: "wallet-a" }, createdAt: { gte: new Date("2026-11-01T00:00:00Z"), lte: now },
    } }))
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ where: { agent: { walletId: "wallet-a" } } }))
    expect(events).not.toHaveBeenCalled()
  })

  it("shows stored keys, actual zero-cost records and unattributed models", async () => {
    vault.mockResolvedValue([{ label: "provider:anthropic" }])
    models.mockResolvedValue([
      { model: "claude-sonnet", _sum: { costUsd: 0 } },
      { model: "unrecognized", _sum: { costUsd: 2 } },
    ])
    const result = await homeOverview("wallet-a", now)
    expect(result.providers[0]).toMatchObject({ keyStatus: "Key stored", spend: 0 })
    expect(result.providers[1].spend).toBeNull()
    expect(result.otherSpend).toBe(2)
  })

  it("shows data-source failures as unavailable", async () => {
    vault.mockRejectedValue(new Error("offline"))
    models.mockRejectedValue(new Error("offline"))
    latest.mockRejectedValue(new Error("offline"))
    const result = await homeOverview("wallet-a", now)
    expect(result.spendUnavailable).toBe(true)
    expect(result.providers[0].keyStatus).toBe("Key status unavailable")
    expect(result.tools.map(t => t.status)).toEqual(["Reporting unavailable", "Reporting unavailable"])
  })

  it("summarizes recent and stale deliveries with links to details and per-tool setup", async () => {
    const stale = new Date("2026-11-24T11:44:59Z")
    latest.mockResolvedValue([
      { source: "claude-code", _max: { receivedAt: now, occurredAt: stale } },
      { source: "codex", _max: { receivedAt: stale, occurredAt: stale } },
    ])
    const data = await homeOverview("wallet-a", now)
    expect(data.tools.map(t => [t.source, t.status])).toEqual([
      ["claude-code", "Recently received"], ["codex", "No recent delivery"],
    ])
    const html = renderToStaticMarkup(HomeOverview({ data }))
    expect(html).toContain("Recently received")
    expect(html).toContain("No recent delivery")
    expect(html.match(/href="\/dashboard\/providers"/g)).toHaveLength(1)
    expect(html).toContain('href="/dashboard/usage"')
    expect(html).toContain('href="/dashboard/connect?source=claude-code"')
    expect(html).toContain('href="/dashboard/connect?source=codex"')
    expect(html).not.toContain("Reported estimate")
  })
})
