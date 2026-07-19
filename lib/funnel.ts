// The acquisition funnel — one source of truth for the Vercel Analytics custom
// events that compose it, in path order. Naming the events here (instead of
// inline string literals scattered across components) is what keeps the funnel
// we build in the Vercel dashboard and the code that fires it from silently
// drifting. `wallet_created` and `first_gateway_call` predate this file and
// keep their exact names so historical data stays continuous.
//
// The leak we're measuring (Eric, 2026-07-20): real landing traffic, near-zero
// wallet conversion. Each stage below is a place a visitor can drop; the point
// of instrumenting all of them is to see WHERE, instead of guessing.
export const FUNNEL = {
  /** Clicked a call-to-action on the marketing page. props: { location, target } */
  landingCta: "landing_cta",
  /** Opened the public demo dashboard (anonymous, demo wallet). */
  demoView: "demo_view",
  /** Approved/denied a live escalation in the demo — the engagement moment. props: { decision } */
  demoDecision: "demo_decision",
  /** Opened the 5-step onboarding tour. props: { trigger } */
  tourStarted: "tour_started",
  /** Reached the last tour step / clicked Done. props: { via } */
  tourCompleted: "tour_completed",
  /** Created a wallet — the conversion. (existing event) */
  walletCreated: "wallet_created",
  /** First metered model call through the gateway. (existing event) */
  firstGatewayCall: "first_gateway_call",
} as const

export type FunnelEvent = (typeof FUNNEL)[keyof typeof FUNNEL]

// Intended order, for the dashboard funnel definition and for docs. The tour
// events sit off to the side (an assist, not a required step), so they're not
// in the main path array.
export const FUNNEL_PATH: FunnelEvent[] = [
  FUNNEL.landingCta,
  FUNNEL.demoView,
  FUNNEL.demoDecision,
  FUNNEL.walletCreated,
  FUNNEL.firstGatewayCall,
]
