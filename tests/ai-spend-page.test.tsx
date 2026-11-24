import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import AiSpendPage from "@/app/dashboard/ai-spend/page"
import { usd } from "@/lib/connectors/money"

const m = vi.hoisted(() => ({ wallet: vi.fn(), view: vi.fn() }))
vi.mock("@/lib/session", () => ({ getViewWallet: m.wallet }))
vi.mock("@/lib/connectors/spendView", () => ({ aiSpendView: m.view }))
vi.mock("@/app/dashboard/ai-spend/cursor-sources", () => ({ CursorSources: () => null }))
vi.mock("@/app/dashboard/ai-spend/actions", () => ({ disconnectUsageToolAction: vi.fn() }))
vi.mock("@/app/dashboard/ai-spend/connect-form", () => ({ ConnectToolForm: () => null, SyncNowForm: () => null }))

it.each([
  { role: "admin", isSession: true, privateDetails: true },
  { role: "viewer", isSession: true, privateDetails: false },
  { role: "owner", isSession: false, privateDetails: false },
])("protects alert amounts for role $role and session $isSession", async ({ role, isSession, privateDetails }) => {
  const date = new Date("2026-11-01T00:00:00Z")
  m.wallet.mockResolvedValue({ id: "w", role, isSession })
  m.view.mockResolvedValue({
    monthStart: date, monthToDate: usd(100), monthBilled: usd(100), monthEstimated: usd(0), lastMonth: usd(0),
    forecast: null, hasData: false, connections: [], alerts: [{
      id: "alert", rule: "daily_cap", subjectType: "person", provider: "cursor", windowStart: date, windowEnd: date,
      observedNanos: usd(72), thresholdNanos: usd(50), evidence: {
        identity: "person@example.test", billedNanos: usd(63).toString(), baselineP95Nanos: usd(11).toString(), top: [],
      },
    }, {
      id: "volume", rule: "cursor_daily_volume", subjectType: "person", provider: "cursor", windowStart: date, windowEnd: date,
      observedNanos: BigInt(0), thresholdNanos: BigInt(0), evidence: {
        identity: "sync@example.test", billedNanos: "0", top: [], volume: {
          reportedTokens: "110000000", cachedTokens: "98765432", requests: "4321", requestsWithTokens: "4320",
          tokenThreshold: "100000000", requestThreshold: "5000",
        },
      },
    }],
  })
  const html = renderToStaticMarkup(await AiSpendPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain("One person passed the daily spend line")
  expect(html).toContain("$100.00")
  for (const value of ["person@example.test", "$72.00", "$50.00", "$63.00", "$11.00", "98,765,432 cache reads", "4,321 requests", "sync@example.test", "View sources for this day"]) {
    expect(html.includes(value)).toBe(privateDetails)
  }
})
