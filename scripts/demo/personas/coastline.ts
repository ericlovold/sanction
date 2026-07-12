// Demo — Coastline Digital: the agency-fleet story. Pools are client
// channels, every spend carries attribution tags, outcomes (bookings) are
// what the spend answers to.
//
// Staged end-state after `history` + `pulse`:
//   · Atlas — the healthy channel: steady spend, bookings landing, tagged
//   · Bluebird — throttled by its cost-per-outcome ceiling: the windowed
//     ratio crossed $60/booking once the 3rd booking landed (min_outcomes
//     cold-start guard), so today's spend ESCALATES with
//     COST_PER_OUTCOME_CEILING — the channel auto-throttles to human-gated
//   · Corsair — the kill switch: frozen by the owner, every spend denies
//     WALLET_FROZEN until unfrozen

import { isWeekday } from "../lib"
import type { Persona, DayPlan } from "../lib"

const ATLAS = "Demo — Coastline / Client — Atlas D2C"
const BLUEBIRD = "Demo — Coastline / Client — Bluebird Health"
const CORSAIR = "Demo — Coastline / Client — Corsair Gaming"

export const coastline: Persona = {
  key: "coastline",
  company: "Demo — Coastline Digital",
  companyPolicy: {
    allowed_categories: ["software", "services", "marketing", "research", "infrastructure"],
    // Sized for the full agency (curated client pods + the healthy new ones).
    daily_spend_budget_usd: 8000,
    daily_token_budget_usd: 400,
    subtree_daily_cap_usd: 6000,
    per_transaction_max_usd: 2000,
    auto_approve_under_usd: 60,
    escalate_over_usd: 300,
  },
  pools: [
    {
      name: ATLAS,
      policy: {
        allowed_categories: ["software", "services", "marketing"],
        daily_spend_budget_usd: 900,
        daily_token_budget_usd: 25,
        per_transaction_max_usd: 800,
        auto_approve_under_usd: 60,
        escalate_over_usd: 250,
        outcome_kind: "booking",
        cost_per_outcome_ceiling_usd: 400, // generous — this channel earns its spend
        cost_per_outcome_window_days: 30,
        cost_per_outcome_min_outcomes: 3,
      },
      seats: [
        { name: "atlas-media-agent", holder: "Coastline · paid media" },
        { name: "atlas-outreach-agent", holder: "Coastline · lifecycle" },
      ],
    },
    {
      name: BLUEBIRD,
      policy: {
        allowed_categories: ["software", "services", "marketing"],
        daily_spend_budget_usd: 400,
        daily_token_budget_usd: 15,
        per_transaction_max_usd: 500,
        auto_approve_under_usd: 50,
        escalate_over_usd: 200,
        outcome_kind: "booking",
        cost_per_outcome_ceiling_usd: 60, // the ratio history crosses: ~$9/day spend, 3 bookings
        cost_per_outcome_window_days: 30,
        cost_per_outcome_min_outcomes: 3,
      },
      seats: [{ name: "bluebird-media-agent", holder: "Coastline · paid media" }],
    },
    {
      name: CORSAIR,
      policy: {
        allowed_categories: ["software", "services", "marketing"],
        daily_spend_budget_usd: 600,
        daily_token_budget_usd: 20,
        per_transaction_max_usd: 600,
        auto_approve_under_usd: 60,
        escalate_over_usd: 250,
      },
      seats: [{ name: "corsair-media-agent", holder: "Coastline · paid media" }],
    },
    // ── Healthy client pods staffed by named account teams — the roster that
    // makes the agency feel like a real shop. Roled seats, filled by `liven`.
    {
      name: "Demo — Coastline / Client — Northwind Retail",
      policy: { allowed_categories: ["software", "services", "marketing"], daily_spend_budget_usd: 1200, daily_token_budget_usd: 40, per_transaction_max_usd: 800, auto_approve_under_usd: 60, escalate_over_usd: 300 },
      seats: [
        { name: "northwind-media-agent", holder: "Devon Pierce", role: "media-buyer" },
        { name: "northwind-social-agent", holder: "Amara Nwosu", role: "marketer" },
        { name: "northwind-creative-agent", holder: "Rafael Ortiz", role: "designer" },
        { name: "northwind-analyst-agent", holder: "Chloe Bennett", role: "analyst" },
      ],
    },
    {
      name: "Demo — Coastline / Client — Vireo Fitness",
      policy: { allowed_categories: ["software", "services", "marketing"], daily_spend_budget_usd: 1000, daily_token_budget_usd: 40, per_transaction_max_usd: 800, auto_approve_under_usd: 60, escalate_over_usd: 300 },
      seats: [
        { name: "vireo-media-agent", holder: "Jasmine Carter", role: "media-buyer" },
        { name: "vireo-content-agent", holder: "Mateo Rossi", role: "marketer" },
        { name: "vireo-lifecycle-agent", holder: "Priyanka Rao", role: "marketer" },
        { name: "vireo-analyst-agent", holder: "Owen Fitzgerald", role: "analyst" },
      ],
    },
  ],
  history: (day: number): DayPlan => {
    const weekday = isWeekday(day) // rough weekday rhythm
    const plan: DayPlan = { tokens: [], spends: [], outcomes: [] }
    // Atlas: the healthy channel — daily media buys + copy tokens, regular bookings.
    plan.tokens.push({
      seat: "atlas-outreach-agent",
      model: "claude-sonnet-4-6",
      tokens_in: 250_000 + (day % 5) * 20_000,
      tokens_out: 40_000,
      cost_usd: 4.2 + (day % 5) * 0.3,
      task: "lifecycle-sequences",
    })
    if (weekday) {
      plan.spends.push({
        seat: "atlas-media-agent",
        action: "purchase",
        amount_usd: 42 + (day % 4) * 5,
        merchant: "Meta Ads",
        category: "marketing",
        description: "Daily prospecting budget",
        tags: { channel: "atlas", play: "d2c-prospecting" },
        expect: "approved",
      })
      if (day % 3 === 0)
        plan.outcomes!.push({
          seat: "atlas-outreach-agent",
          kind: "booking",
          value_usd: 240,
          play: "d2c-prospecting",
          dedupe_key: `atlas-booking-${day}`,
        })
    }
    // Bluebird: spends small and auto-approved all month; only 2 bookings land
    // before the final history day, so the ceiling's min_outcomes guard keeps
    // it silent while the ratio quietly climbs past $60/booking.
    if (weekday) {
      plan.spends.push({
        seat: "bluebird-media-agent",
        action: "purchase",
        amount_usd: 9 + (day % 3),
        merchant: "Google Ads",
        category: "marketing",
        description: "Search defense",
        tags: { channel: "bluebird", play: "branded-search" },
        expect: "approved",
      })
    }
    if (day === 20 || day === 10 || day === 1)
      plan.outcomes!.push({
        seat: "bluebird-media-agent",
        kind: "booking",
        value_usd: 180,
        play: "branded-search",
        dedupe_key: `bluebird-booking-${day}`,
      })
    // Corsair: normal traffic all month — the freeze happens today, on stage.
    if (weekday && day % 2 === 0)
      plan.spends.push({
        seat: "corsair-media-agent",
        action: "purchase",
        amount_usd: 35 + (day % 5) * 4,
        merchant: "TikTok Ads",
        category: "marketing",
        description: "Creator boost",
        tags: { channel: "corsair", play: "creator-boost" },
        expect: "approved",
      })
    return plan
  },
  // For DB-less targets (prod): arm Bluebird's ceiling through the API alone —
  // today's approved spend supplies the ratio's numerator (4 × $48 = $192),
  // three recent backdated bookings (occurred_at) satisfy min_outcomes:
  // $192 / 3 = $64 > the $60 ceiling, so the next spend escalates.
  //
  // The arming DECAYS by design: a throttled channel approves nothing, so its
  // windowed spend only ages out — after ~25 days (bookings at 5/3/1 days ago
  // sliding past the 30-day window) the ratio disarms and the daily pulse
  // flags Bluebird approved-instead-of-escalated. That red run is the
  // maintenance beat: re-run `prime coastline` (dedupe keys are date-scoped,
  // so re-priming mints fresh rows). `history` supersedes this when direct
  // DB access exists.
  prime: {
    spends: [
      { seat: "bluebird-media-agent", action: "purchase", amount_usd: 48, merchant: "Google Ads", category: "marketing", description: "Search defense — week 1 batch", tags: { channel: "bluebird", play: "branded-search" }, expect: "approved" },
      { seat: "bluebird-media-agent", action: "purchase", amount_usd: 48, merchant: "Google Ads", category: "marketing", description: "Search defense — week 2 batch", tags: { channel: "bluebird", play: "branded-search" }, expect: "approved" },
      { seat: "bluebird-media-agent", action: "purchase", amount_usd: 48, merchant: "Google Ads", category: "marketing", description: "Search defense — week 3 batch", tags: { channel: "bluebird", play: "branded-search" }, expect: "approved" },
      { seat: "bluebird-media-agent", action: "purchase", amount_usd: 48, merchant: "Google Ads", category: "marketing", description: "Search defense — week 4 batch", tags: { channel: "bluebird", play: "branded-search" }, expect: "approved" },
    ],
    outcomes: [
      { seat: "bluebird-media-agent", kind: "booking", value_usd: 180, play: "branded-search", dedupe_key: `bluebird-booking-p5-${new Date().toISOString().slice(0, 10)}`, days_ago: 5 },
      { seat: "bluebird-media-agent", kind: "booking", value_usd: 180, play: "branded-search", dedupe_key: `bluebird-booking-p3-${new Date().toISOString().slice(0, 10)}`, days_ago: 3 },
      { seat: "bluebird-media-agent", kind: "booking", value_usd: 180, play: "branded-search", dedupe_key: `bluebird-booking-p1-${new Date().toISOString().slice(0, 10)}`, days_ago: 1 },
    ],
  },
  pulse: {
    freezePools: [{ pool: CORSAIR, reason: "Client paused the engagement — spend stop while renegotiating" }],
    tokens: [
      { seat: "atlas-outreach-agent", model: "claude-sonnet-4-6", tokens_in: 280_000, tokens_out: 45_000, cost_usd: 4.6, task: "lifecycle-sequences" },
      { seat: "atlas-media-agent", model: "claude-haiku-4-5", tokens_in: 150_000, tokens_out: 18_000, cost_usd: 1.4, task: "creative-variants" },
      { seat: "bluebird-media-agent", model: "claude-haiku-4-5", tokens_in: 120_000, tokens_out: 15_000, cost_usd: 1.1, task: "serp-watch" },
    ],
    spends: [
      { seat: "atlas-media-agent", action: "purchase", amount_usd: 48, merchant: "Meta Ads", category: "marketing", description: "Daily prospecting budget", tags: { channel: "atlas", play: "d2c-prospecting" }, expect: "approved" },
      // The throttle: ratio ~$87/booking > $60 ceiling — even a $12 charge escalates.
      { seat: "bluebird-media-agent", action: "purchase", amount_usd: 12, merchant: "Google Ads", category: "marketing", description: "Search defense", tags: { channel: "bluebird", play: "branded-search" }, expect: "escalated", then: "leave-pending" },
      // The kill switch: frozen channel denies everything.
      { seat: "corsair-media-agent", action: "purchase", amount_usd: 30, merchant: "TikTok Ads", category: "marketing", description: "Creator boost", tags: { channel: "corsair", play: "creator-boost" }, expect: "denied" },
    ],
    tools: [],
    injections: [],
    outcomes: [
      { seat: "atlas-outreach-agent", kind: "booking", value_usd: 260, play: "d2c-prospecting", dedupe_key: "atlas-booking-today" },
    ],
  },
}
