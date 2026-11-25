import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { vault, facts, models, latest, events, conns, exportRows, tenant } = vi.hoisted(() => ({
  vault: vi.fn(), facts: vi.fn(), models: vi.fn(), latest: vi.fn(), events: vi.fn(),
  conns: vi.fn(), exportRows: vi.fn(), tenant: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: {
  tokenLog: { groupBy: models },
  usageObservation: { groupBy: latest, findMany: events },
  usageConnection: { findMany: conns },
  cursorBillingItem: { groupBy: exportRows },
} }))
vi.mock("@/lib/rls", () => ({ withTenant: tenant }))
import { HomeOverview } from "@/components/home-overview"
import { homeOverview } from "@/lib/homeOverview"

const now = new Date("2026-11-24T12:00:00Z")
const monthStart = new Date("2026-11-01T00:00:00Z")
const html = (data: Awaited<ReturnType<typeof homeOverview>>, canConnect = false) =>
  renderToStaticMarkup(HomeOverview({ data, canConnect }))

beforeEach(() => {
  vi.resetAllMocks()
  tenant.mockImplementation((_id, fn) => fn({ credentialVault: { findMany: vault }, usageFact: { groupBy: facts } }))
  for (const read of [vault, facts, models, latest, conns, exportRows]) read.mockResolvedValue([])
})

describe("Home overview data", () => {
  it("shows no provider or tool cards when nothing is connected", async () => {
    const data = await homeOverview("wallet-a", now)
    expect(data.view.kind).toBe("empty")
    const page = html(data, true)
    expect(page).toContain("No AI tools connected yet.")
    expect(page).toContain('href="/dashboard/tools"')
    for (const name of ["Gemini", "Perplexity", "Codex", "No stored key", "Not connected"]) expect(page).not.toContain(name)
  })

  it("tells a viewer who cannot connect who can", async () => {
    const page = html(await homeOverview("wallet-a", now), false)
    expect(page).toContain("A wallet admin can connect your tools.")
    expect(page).not.toContain('href="/dashboard/tools"')
  })

  it("scopes every read to the current wallet and month without loading session events", async () => {
    await homeOverview("wallet-a", now)
    expect(tenant).toHaveBeenCalledWith("wallet-a", expect.any(Function))
    expect(vault).toHaveBeenCalledWith(expect.objectContaining({ where: {
      walletId: "wallet-a", label: { startsWith: "provider:" }, revokedAt: null,
    } }))
    expect(models).toHaveBeenCalledWith(expect.objectContaining({ where: {
      agent: { walletId: "wallet-a" }, createdAt: { gte: monthStart, lte: now },
    } }))
    expect(facts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      walletId: "wallet-a", bucketStart: { gte: monthStart, lte: now },
    } }))
    expect(conns).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId: "wallet-a", status: { not: "disconnected" } } }))
    expect(exportRows).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId: "wallet-a" } }))
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ where: { agent: { walletId: "wallet-a" } } }))
    expect(events).not.toHaveBeenCalled()
  })

  it("says connections are unknown, not absent, when every read fails", async () => {
    for (const read of [vault, facts, models, latest, conns, exportRows]) read.mockRejectedValue(new Error("offline"))
    const data = await homeOverview("wallet-a", now)
    expect(data.view.kind).toBe("unavailable")
    expect(data.otherSpend).toBeNull()
    const page = html(data, true)
    expect(page).toContain("This does not mean nothing is connected.")
    expect(page).not.toContain("No AI tools connected yet.")
  })

  it("shows only the connected tools, with the billed figure as the headline", async () => {
    vault.mockResolvedValue([{ label: "provider:anthropic" }])
    models.mockResolvedValue([
      { model: "claude-sonnet", _sum: { costUsd: 3 } },
      { model: "unrecognized", _sum: { costUsd: 2 } },
    ])
    conns.mockResolvedValue([{ provider: "anthropic", status: "active", statusCode: null, lastSuccessAt: new Date("2026-11-24T11:00:00Z") }])
    facts.mockResolvedValue([
      { provider: "anthropic", costBasis: "billed", _sum: { costNanos: BigInt(40_000_000_000) } },
      { provider: "anthropic", costBasis: "estimated", _sum: { costNanos: BigInt(9_000_000_000) } },
    ])
    const data = await homeOverview("wallet-a", now)
    if (data.view.kind !== "tools") throw new Error(data.view.kind)
    expect(data.view.tools.map((t) => t.id)).toEqual(["claude"])
    expect(data.view.tools[0].headline).toEqual({ usd: 40, source: "billed" })
    expect(data.view.tools[0].alsoRecordedUsd).toBe(3)
    expect(data.otherSpend).toBe(2)
    const page = html(data, true)
    expect(page).toContain("Billed by the provider this month")
    expect(page).toContain("which may already be in the billed total")
    expect(page).toContain('href="/dashboard/tools"')
    for (const name of ["Gemini", "Perplexity", "Codex", "OpenAI"]) expect(page).not.toContain(name)
  })

  it("flags an admin key the provider refused", async () => {
    conns.mockResolvedValue([{ provider: "openai", status: "error", statusCode: "bad_key", lastSuccessAt: null }])
    const data = await homeOverview("wallet-a", now)
    if (data.view.kind !== "tools") throw new Error(data.view.kind)
    expect(data.view.tools[0].methods[0]).toMatchObject({ state: "attention", detail: "The provider refused the key. Reconnect it." })
  })

  it("counts recorded spend for a provider without a tool card as other spend", async () => {
    vault.mockResolvedValue([{ label: "provider:perplexity" }])
    models.mockResolvedValue([{ model: "sonar-pro", _sum: { costUsd: 1.5 } }])
    const data = await homeOverview("wallet-a", now)
    expect(data.view.kind).toBe("empty")
    expect(data.otherSpend).toBe(1.5)
  })

  it("connects collectors that have delivered and billing exports that were imported", async () => {
    latest.mockResolvedValue([
      { source: "claude-code", _max: { receivedAt: now, occurredAt: now } },
      { source: "codex", _max: { receivedAt: new Date("2026-11-24T11:44:59Z"), occurredAt: now } },
    ])
    exportRows.mockResolvedValue([{ product: "cursor" }, { product: "not-a-product" }])
    const data = await homeOverview("wallet-a", now)
    if (data.view.kind !== "tools") throw new Error(data.view.kind)
    expect(data.view.tools.map((t) => [t.id, t.methods.map((m) => m.state)])).toEqual([
      ["claude", ["ok"]], ["codex", ["waiting"]], ["cursor", ["ok"]],
    ])
    const page = html(data)
    expect(page).toContain('href="/dashboard/connect?source=claude-code"')
    expect(page).toContain('href="/dashboard/usage/cursor"')
    expect(page).toContain("No spend figure yet")
  })

  it("keeps what it found when one read fails, and says a tool may be missing", async () => {
    vault.mockRejectedValue(new Error("offline"))
    latest.mockResolvedValue([{ source: "codex", _max: { receivedAt: now, occurredAt: now } }])
    const data = await homeOverview("wallet-a", now)
    if (data.view.kind !== "tools") throw new Error(data.view.kind)
    expect(data.view.partial).toBe(true)
    expect(html(data)).toContain("a tool may be missing")
  })
})
