import { Children, isValidElement } from "react"
import { describe, expect, it, vi } from "vitest"
import AiSpendPage from "@/app/dashboard/ai-spend/page"
import { CursorSources } from "@/app/dashboard/ai-spend/cursor-sources"

const wallet = vi.hoisted(() => vi.fn())
vi.mock("@/lib/session", () => ({ getViewWallet: wallet }))
vi.mock("@/app/dashboard/ai-spend/actions", () => ({ disconnectUsageToolAction: vi.fn() }))
vi.mock("@/app/dashboard/ai-spend/connect-form", () => ({ ConnectToolForm: vi.fn(), SyncNowForm: vi.fn() }))
vi.mock("@/lib/connectors/spendView", () => ({
  aiSpendView: async () => ({
    connections: [], alerts: [], people: [], hasData: false,
    monthToDate: BigInt(0), monthBilled: BigInt(0), monthEstimated: BigInt(0), forecast: null,
    monthStart: new Date("2024-01-01"), lastMonthPartial: true, lastMonth: BigInt(0),
  }),
}))

describe("Cursor source access", () => {
  it.each([
    ["admin", true, true], ["owner", true, true], ["viewer", true, false], ["viewer", false, false],
  ] as const)("role %s, session %s has source access %s", async (role, isSession, allowed) => {
    wallet.mockResolvedValue({ id: "selected-wallet", role, isSession })
    const page = await AiSpendPage({ searchParams: Promise.resolve({ cursor_day: "2024-02-01" }) })
    const panel = Children.toArray(page.props.children).find((child) => isValidElement(child) && child.type === CursorSources)
    expect(Boolean(panel)).toBe(allowed)
    if (allowed) expect(panel).toMatchObject({ props: { walletId: "selected-wallet", day: "2024-02-01" } })
  })
})
