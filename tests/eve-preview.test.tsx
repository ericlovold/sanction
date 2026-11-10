import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { EvePreview } from "@/app/dashboard/eve/eve-preview"
import { DashboardSidebar } from "@/components/dashboard-sidebar"

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }))
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }))

describe("eve preview honesty", () => {
  it("labels the page as preview example data, not live connectors", () => {
    const html = renderToStaticMarkup(createElement(EvePreview))
    expect(html).toContain("Preview, example data")
    expect(html).toContain("Preview: how eve will surface your AI seats")
    expect(html).toContain("example data — not connector output")
    expect(html).toContain("This toggle is local to this page")
    expect(html).toContain("Coming soon")
    expect(html).toContain("npx eve@latest init sanction-agent")
    expect(html).not.toContain("provenance: eve connectors")
    expect(html).not.toContain("Let eve find your AI seats")
    expect(html).toContain("Preview observe mode, local only")
  })

  it("keeps eve off the default signed-in sidebar", () => {
    const html = renderToStaticMarkup(createElement(DashboardSidebar, {
      view: { name: "Test", isSession: true },
      pendingCount: 0,
      account: null,
    }))
    expect(html).not.toContain("/dashboard/eve")
    expect(html).toContain("/dashboard/approvals")
    expect(html).toContain("/dashboard/vault")
  })
})
