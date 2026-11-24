import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { UsageReportNav } from "@/components/usage-report-nav"
import type { WalletRole } from "@/lib/roles"
import { safeNext } from "@/lib/returnPath"
import ConnectPage from "@/app/dashboard/connect/page"
import UsagePage from "@/app/dashboard/usage/page"

const mocks = vi.hoisted(() => ({
  path: vi.fn(),
  wallet: vi.fn(),
  connection: vi.fn(),
  usage: vi.fn(),
}))
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), usePathname: mocks.path }))
vi.mock("@/lib/session", () => ({ getViewWallet: mocks.wallet }))
vi.mock("@/lib/usageView", () => ({ usageView: mocks.usage }))
vi.mock("@/lib/developerConnection", () => ({ developerConnection: mocks.connection }))
vi.mock("@/lib/brokerWalkthrough", () => ({ completedWalkthroughProof: vi.fn() }))

const wallet = (role: WalletRole, isSession = true) => ({ id: "wallet", name: "Personal", role, isSession })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.usage.mockResolvedValue({
    connections: ["claude-code", "codex"].map(source => ({
      source, status: "No events received", receivedAt: null, occurredAt: null,
    })),
    sessions: [],
    truncated: false,
  })
})

describe("usage report navigation", () => {
  it.each([
    ["/dashboard/usage", "Client sessions", "page"],
    ["/dashboard/connect", "Client sessions", "location"],
    ["/dashboard/usage/cursor", "Tool billing", "location"],
    ["/dashboard/usage/grok-bot", "Tool billing", "location"],
    ["/dashboard/ai-spend", "Tool billing", "page"],
    ["/dashboard/spend", "Spend &amp; budgets", "page"],
  ])("marks the report for %s", (path, label, current) => {
    mocks.path.mockReturnValue(path)
    const html = renderToStaticMarkup(createElement(UsageReportNav))
    expect(html.match(/aria-current=/g)).toHaveLength(1)
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="${current}"[^>]*>${label}</a>`))
  })

  it("keeps report navigation off the Home page", () => {
    mocks.path.mockReturnValue("/dashboard")
    expect(renderToStaticMarkup(createElement(UsageReportNav))).toBe("")
  })
})

describe("individual usage setup", () => {
  it.each([
    { view: null, source: "codex", next: "/dashboard/connect?source=codex" },
    { view: wallet("viewer", false), source: "claude-code", next: "/dashboard/connect?source=claude-code" },
    { view: null, source: "//elsewhere.example", next: "/dashboard/connect" },
  ])("preserves only a supported tool through sign-in ($source)", async ({ view, source, next }) => {
    mocks.wallet.mockResolvedValue(view)
    const html = renderToStaticMarkup(await ConnectPage({ searchParams: Promise.resolve({ source, seat: "old-wallet-seat" }) }))
    const loginHref = html.match(/href="(\/login\?next=[^"]+)"/)?.[1]
    expect(loginHref).toBeDefined()
    const returnPath = new URL(loginHref!, "https://example.test").searchParams.get("next")
    expect(safeNext(returnPath)).toBe(next)
    expect(html).toContain("Sign in or create a wallet")
    expect(html).not.toContain('href="/start"')
    expect(mocks.connection).not.toHaveBeenCalled()
  })

  it("keeps Claude cost estimates separate from Codex session tokens", async () => {
    mocks.wallet.mockResolvedValue(wallet("owner"))
    mocks.usage.mockResolvedValue({
      connections: [], truncated: false,
      sessions: [{
        key: "local-codex", sessionId: "session", source: "codex", seat: "Local",
        lastEvent: new Date(), modelCalls: 1, unmeteredCalls: 0, unpricedCalls: 1,
        tokensIn: 24, tokensOut: 8, estimatedCost: 0,
      }],
    })
    const html = renderToStaticMarkup(await UsagePage())
    expect(html).toContain("Claude Code also reports cost estimates when available.")
    expect(html).toContain("24 / 8")
    expect(html).toContain(">Unavailable</td>")
    expect(html).not.toContain("$0.0000")
  })

  it.each([
    { view: wallet("viewer", false), canCreate: false },
    { view: wallet("viewer"), canCreate: false },
    { view: wallet("admin"), canCreate: true },
    { view: wallet("owner"), canCreate: true },
  ])("offers each tool's setup and respects seat permissions ($view.role, session $view.isSession)", async ({ view, canCreate }) => {
    mocks.wallet.mockResolvedValue(view)
    const html = renderToStaticMarkup(await UsagePage())
    expect(html).toContain('href="/dashboard/connect?source=claude-code"')
    expect(html).toContain('href="/dashboard/connect?source=codex"')
    expect(html.includes('href="/dashboard/agents"')).toBe(canCreate)
    expect(html.includes("Ask a wallet admin")).toBe(view.isSession && !canCreate)
  })
})
