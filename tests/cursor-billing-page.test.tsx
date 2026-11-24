import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import CursorUsagePage from "@/app/dashboard/usage/cursor/page"

const mocks = vi.hoisted(() => ({ member: vi.fn(), groupBy: vi.fn(), queryRaw: vi.fn() }))
vi.mock("@/lib/session", () => ({ getSessionMember: mocks.member }))
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.queryRaw, cursorBillingItem: { groupBy: mocks.groupBy } } }))
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
