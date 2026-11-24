import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import CursorUsagePage from "@/app/dashboard/usage/cursor/page"

const mocks = vi.hoisted(() => ({ member: vi.fn(), groupBy: vi.fn() }))
vi.mock("@/lib/session", () => ({ getSessionMember: mocks.member }))
vi.mock("@/lib/db", () => ({ db: { cursorBillingItem: { groupBy: mocks.groupBy } } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => vi.resetAllMocks())

it("requires a session before reading wallet billing observations", async () => {
  mocks.member.mockResolvedValue(null)
  expect(renderToStaticMarkup(await CursorUsagePage())).toContain("Sign in")
  expect(mocks.groupBy).not.toHaveBeenCalled()
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
