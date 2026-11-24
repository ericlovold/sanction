import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { Prisma } from "@/lib/generated/prisma/client"
import CursorUsagePage from "@/app/dashboard/usage/cursor/page"

const mocks = vi.hoisted(() => ({ member: vi.fn(), groupBy: vi.fn(), queryRaw: vi.fn(), sources: vi.fn() }))
vi.mock("@/lib/session", () => ({ getSessionMember: mocks.member }))
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.queryRaw, cursorBillingItem: { groupBy: mocks.groupBy } } }))
vi.mock("@/lib/connectors/cursorSources", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/connectors/cursorSources")>(), cursorSources: mocks.sources,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queryRaw.mockResolvedValue([])
})

it("requires a session before reading wallet billing observations", async () => {
  mocks.member.mockResolvedValue(null)
  expect(renderToStaticMarkup(await CursorUsagePage())).toContain("Sign in")
  expect(mocks.groupBy).not.toHaveBeenCalled()
  expect(mocks.queryRaw).not.toHaveBeenCalled()
})

it.each(["viewer", "admin", "owner"])("shows billing coverage with role-appropriate controls to %s", async role => {
  mocks.member.mockResolvedValue({ role, wallet: { id: "test-wallet", name: "Test" } })
  mocks.groupBy.mockResolvedValue([{
    product: "cursor", chargeCategory: "usage", usageType: "on_demand", currency: "USD",
    _count: { _all: 2, promptTokens: 1, completionTokens: 2, cachedPromptTokens: 0, cacheWriteTokens: 1, contracted: 2 },
    _sum: { promptTokens: 13, completionTokens: 0, cachedPromptTokens: null, cacheWriteTokens: 19, contracted: { toFixed: () => "0.0000000001" } },
    _min: { occurredAt: new Date("2026-10-01") }, _max: { occurredAt: new Date("2026-10-02") },
  }])
  const html = renderToStaticMarkup(await CursorUsagePage())
  expect(mocks.groupBy.mock.calls[0][0].where).toEqual({ walletId: "test-wallet" })
  expect(html.includes("Import billing items")).toBe(role !== "viewer")
  expect(html).toContain("13 (partial)")
  expect(html).toContain("Unavailable")
  expect(html).toContain("0.0000000001")
  expect(html).toContain("on_demand")
})

it("sums reported units across models and flags partial days", async () => {
  mocks.member.mockResolvedValue({ role: "viewer", wallet: { id: "scoped", name: "Test" } })
  mocks.groupBy.mockResolvedValue([])
  const row = { day: "2026-11-23", items: BigInt(1), partial: false, cachedPartial: false }
  mocks.queryRaw.mockResolvedValue([
    { ...row, model: "Model A", tokens: BigInt(900), cached: BigInt(300) },
    { ...row, model: "Model B", tokens: BigInt(300), cached: BigInt(0) },
    { ...row, model: null, tokens: null, cached: null, partial: true, cachedPartial: true },
    { ...row, day: "2026-11-22", model: "Model C", tokens: BigInt(0), cached: BigInt(0) },
  ])
  const html = renderToStaticMarkup(await CursorUsagePage())
  const [query, wallet] = mocks.queryRaw.mock.calls[0]
  expect(query.join("?")).toContain('WHERE "walletId" = ?')
  expect(wallet).toBe("scoped")
  expect(html).toContain("1,200 (partial)")
  expect(html).toContain("25.0% (partial)")
  expect(html).toContain("300 (partial)")
  expect(html).toContain("33.3%")
  expect(html).toContain("0.0%")
  expect(html).toContain("Model unreported")
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toMatch(/Infinity|NaN/)
})

it("flags a cache-heavy included-usage day using reported units across models", async () => {
  mocks.member.mockResolvedValue({ role: "owner", wallet: { id: "test", name: "Test" } })
  mocks.groupBy.mockResolvedValue([])
  const row = { day: "2026-11-17", partial: false, cachedPartial: false }
  mocks.queryRaw.mockResolvedValue([
    { ...row, model: "Model A", items: BigInt(9525), tokens: BigInt(864585850), cached: BigInt(786051146) },
    { ...row, model: "Model B", items: BigInt(50), tokens: BigInt(5771831), cached: BigInt(5143552) },
  ])
  const html = renderToStaticMarkup(await CursorUsagePage())
  expect(html).toContain(">High volume<")
  expect(html).toContain("870,357,681")
  expect(html).toContain("791,194,698")
  expect(html).toContain("90.9%")
})

it.each(["admin", "viewer"])("scopes selected-day evidence and source links for %s", async role => {
  const day = "2026-11-17"
  const start = new Date(day)
  mocks.member.mockResolvedValue({ role, wallet: { id: "test", name: "Example" } })
  mocks.queryRaw.mockResolvedValue([{ day, model: null, items: BigInt(3), tokens: BigInt(10), cached: BigInt(8), partial: false, cachedPartial: false }])
  mocks.groupBy.mockResolvedValue([{ usageType: "on_demand", currency: "USD", _sum: { contracted: new Prisma.Decimal("3.5817012") }, _count: { _all: 3, contracted: 2 }, _max: { occurredAt: start } }])
  mocks.sources.mockResolvedValue({ rows: [{ id: "test-run" }] })
  const html = renderToStaticMarkup(await CursorUsagePage({ searchParams: Promise.resolve({ day }) }))
  expect(mocks.groupBy.mock.calls[0][0].where).toEqual({ walletId: "test", occurredAt: { gte: start, lt: new Date("2026-11-18") } })
  expect(html).toContain('title="USD 3.5817012">$3.58</span> (partial)')
  expect(html).toContain("80.0%")
  expect(html).toContain("no model names")
  expect(html).toContain("omit run and automation IDs")
  if (role === "admin") {
    expect(mocks.sources).toHaveBeenCalledWith("test", start)
    expect(html).toContain("cursor_day=2026-11-17#cursor-sources")
  } else {
    expect(mocks.sources).not.toHaveBeenCalled()
    expect(html).toContain("https://cursor.com/agents")
  }
})

it("shows missing imported and synced evidence without implying zero usage", async () => {
  mocks.member.mockResolvedValue({ role: "owner", wallet: { id: "test", name: "Example" } })
  mocks.groupBy.mockResolvedValue([])
  mocks.sources.mockResolvedValue({ rows: [] })
  const html = renderToStaticMarkup(await CursorUsagePage({ searchParams: Promise.resolve({ day: "2026-11-17" }) }))
  expect(html).toContain("No imported Cursor billing items")
  expect(html).toContain("Open Cursor run history")
})

it("rejects invalid days before querying billing or synced records", async () => {
  mocks.member.mockResolvedValue({ role: "owner", wallet: { id: "test" } })
  const html = renderToStaticMarkup(await CursorUsagePage({ searchParams: Promise.resolve({ day: "2025-02-30" }) }))
  expect(html).toContain("Invalid Cursor usage date")
  expect(mocks.groupBy).not.toHaveBeenCalled()
  expect(mocks.queryRaw).not.toHaveBeenCalled()
  expect(mocks.sources).not.toHaveBeenCalled()
})

it("preserves the incident link through sign-in", async () => {
  mocks.member.mockResolvedValue(null)
  const html = renderToStaticMarkup(await CursorUsagePage({ searchParams: Promise.resolve({ day: "2026-11-17" }) }))
  expect(html).toContain(encodeURIComponent("/dashboard/usage/cursor?day=2026-11-17#incident"))
  expect(mocks.queryRaw).not.toHaveBeenCalled()
})
