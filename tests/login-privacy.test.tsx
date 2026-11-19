import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ pathname: "/dashboard" }))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }))
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }))
vi.mock("@/components/verify-magic-link", () => ({ VerifyMagicLink: () => null }))
import { PrivacyAnalytics } from "../components/privacy-analytics"
import { metadata } from "../app/auth/verify/page"
import nextConfig from "../next.config"

const verificationPaths = ["/auth/verify", "/connect/mcp/login/verify"]
type AnalyticsElement = ReactElement<{ beforeSend: (event: { type: string; url: string }) => unknown }>

beforeEach(() => { state.pathname = "/dashboard" })

describe("credential verification privacy", () => {
  it.each(verificationPaths)("does not mount analytics on %s", path => {
    state.pathname = path
    expect(PrivacyAnalytics()).toBeNull()
  })

  it.each(verificationPaths)("suppresses %s events from an already-loaded analytics script", path => {
    const analytics = PrivacyAnalytics() as AnalyticsElement
    expect(analytics.props.beforeSend({ type: "pageview", url: `https://getsanction.com${path}?token=fixture-only` })).toBeNull()
  })

  it("keeps ordinary page analytics", () => {
    const analytics = PrivacyAnalytics() as AnalyticsElement
    const event = { type: "pageview", url: "https://getsanction.com/dashboard?view=spend" }
    expect(analytics.props.beforeSend(event)).toBe(event)
  })

  it.each(verificationPaths)("sets no-referrer and no-store response headers on %s", async path => {
    const rules = await nextConfig.headers!()
    const route = rules.find(rule => rule.source === path)
    expect(route?.headers).toEqual(expect.arrayContaining([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ]))
  })

  it("keeps legacy verification out of search indexes and referrers", () => {
    expect(metadata.referrer).toBe("no-referrer")
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })
})
