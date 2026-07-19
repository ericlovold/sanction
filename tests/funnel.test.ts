import { describe, it, expect } from "vitest"
import { FUNNEL, FUNNEL_PATH } from "@/lib/funnel"

// The event names are a contract with the funnel we build in Vercel Analytics —
// rename one here without updating the dashboard and the funnel silently breaks.
// Pin them so that can't happen quietly, and so the two events that predate this
// file keep their historical names (renaming them would orphan past data).
describe("funnel event taxonomy", () => {
  it("pins every event name", () => {
    expect(FUNNEL).toEqual({
      landingCta: "landing_cta",
      demoView: "demo_view",
      demoDecision: "demo_decision",
      tourStarted: "tour_started",
      tourCompleted: "tour_completed",
      walletCreated: "wallet_created",
      firstGatewayCall: "first_gateway_call",
    })
  })

  it("keeps the pre-existing events at their original names (data continuity)", () => {
    expect(FUNNEL.walletCreated).toBe("wallet_created")
    expect(FUNNEL.firstGatewayCall).toBe("first_gateway_call")
  })

  it("orders the main conversion path landing → demo → decision → wallet → first call", () => {
    expect(FUNNEL_PATH).toEqual([
      "landing_cta",
      "demo_view",
      "demo_decision",
      "wallet_created",
      "first_gateway_call",
    ])
  })

  it("uses snake_case event names (Vercel Analytics convention)", () => {
    for (const name of Object.values(FUNNEL)) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/)
    }
  })
})
