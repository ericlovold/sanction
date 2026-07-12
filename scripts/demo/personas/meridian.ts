// Demo — Meridian Analytics: the internal-AI-governance story (the primary
// use case). Departments as pools, seats with named holders, gateway-style
// token metering against pooled caps, and a spend ladder staged so the demo
// opens with something to approve.
//
// Staged end-state after `pulse`:
//   · Engineering token burn ≈ 87% of its pooled daily cap (the runway moment)
//   · ci-agent denied over its own daily token line (fail-closed, seat-level)
//   · one spend escalation LEFT PENDING (the thing Eric approves on stage)
//   · one escalation approved via the owner API and redeemed (grant-consumed
//     history in the audit trail)
//   · denials with stable codes: over per-txn cap, blocked category, blocked tool
//   · one exec→inject round-trip (scoped JWT, clearance-gated vault read)

import { isWeekday } from "../lib"
import type { Persona, DayPlan } from "../lib"

export const meridian: Persona = {
  key: "meridian",
  company: "Demo — Meridian Analytics",
  companyPolicy: {
    allowed_categories: ["software", "services", "research", "infrastructure", "marketing"],
    // Caps sized for the full ~25-seat org (the departments below), not just the
    // three curated pools. Headroom so `liven` never trips a company-level cap.
    daily_spend_budget_usd: 8000,
    daily_token_budget_usd: 600,
    subtree_daily_cap_usd: 6000,
    subtree_daily_token_cap_usd: 1200,
    per_transaction_max_usd: 1500,
    auto_approve_under_usd: 50,
    escalate_over_usd: 200,
    escalation_timeout_mins: 240,
    escalation_timeout_action: "deny",
  },
  pools: [
    {
      name: "Demo — Meridian / Engineering",
      policy: {
        daily_spend_budget_usd: 400,
        daily_token_budget_usd: 20, // per-seat default
        subtree_daily_token_cap_usd: 55, // the pooled department cap
        per_transaction_max_usd: 500,
        auto_approve_under_usd: 25,
        escalate_over_usd: 100,
      },
      seats: [
        { name: "ci-agent", holder: "Priya Natarajan", overrides: { daily_token_budget_usd: 10 } },
        { name: "code-review-agent", holder: "Marcus Tran" },
        { name: "infra-agent", holder: "Dana Kowalski", overrides: { clearance: 2 } },
      ],
      vault: [
        { label: "OPENAI_API_KEY", type: "api_key", value: "demo-not-a-real-key-openai", min_clearance: 2 },
        { label: "DATADOG_API_KEY", type: "api_key", value: "demo-not-a-real-key-datadog" },
      ],
    },
    {
      name: "Demo — Meridian / Marketing",
      policy: {
        daily_spend_budget_usd: 800,
        daily_token_budget_usd: 15,
        per_transaction_max_usd: 1000,
        auto_approve_under_usd: 50,
        escalate_over_usd: 150,
        allowed_categories: ["software", "services", "marketing"],
        blocked_categories: ["crypto"],
      },
      seats: [
        { name: "content-agent", holder: "Jules Beaumont" },
        { name: "seo-agent", holder: "Sam Okafor" },
      ],
    },
    {
      name: "Demo — Meridian / Support",
      policy: {
        daily_spend_budget_usd: 150,
        daily_token_budget_usd: 12,
        per_transaction_max_usd: 200,
        auto_approve_under_usd: 25,
        escalate_over_usd: 75,
        escalate_tools: ["email.send"],
        blocked_tools: ["shell.exec"],
      },
      seats: [
        { name: "triage-agent", holder: "Ren Ishikawa" },
        { name: "kb-agent", holder: "Alma Reyes" },
      ],
    },
    // ── Departments that make the org read as a real 25-person company. Their
    // seats carry a `role` (not curated moments), so `liven` fills today's burn.
    // Generous per-seat + pool caps keep livening under budget (no denials).
    {
      name: "Demo — Meridian / Platform Engineering",
      policy: { daily_spend_budget_usd: 1200, daily_token_budget_usd: 40, subtree_daily_token_cap_usd: 320, per_transaction_max_usd: 500, auto_approve_under_usd: 50, escalate_over_usd: 200 },
      seats: [
        { name: "backend-agent", holder: "Tomás Herrera", role: "engineer" },
        { name: "frontend-agent", holder: "Wei Zhang", role: "engineer" },
        { name: "sre-agent", holder: "Nadia Boukhari", role: "engineer", overrides: { clearance: 2 } },
        { name: "release-agent", holder: "Kofi Mensah", role: "engineer" },
        { name: "platform-qa-agent", holder: "Elena Petrova", role: "engineer" },
      ],
    },
    {
      name: "Demo — Meridian / Data Science",
      policy: { daily_spend_budget_usd: 1200, daily_token_budget_usd: 40, subtree_daily_token_cap_usd: 340, per_transaction_max_usd: 500, auto_approve_under_usd: 50, escalate_over_usd: 200 },
      seats: [
        { name: "ml-agent", holder: "Arjun Malhotra", role: "data-scientist" },
        { name: "eval-agent", holder: "Sofia Castellano", role: "data-scientist" },
        { name: "feature-agent", holder: "Daniel Osei", role: "data-scientist" },
        { name: "insights-agent", holder: "Mei-Ling Chen", role: "analyst" },
        { name: "experiments-agent", holder: "Lucas Brandt", role: "data-scientist" },
      ],
    },
    {
      name: "Demo — Meridian / Growth Marketing",
      policy: { allowed_categories: ["software", "services", "marketing"], daily_spend_budget_usd: 1500, daily_token_budget_usd: 40, subtree_daily_token_cap_usd: 240, per_transaction_max_usd: 600, auto_approve_under_usd: 50, escalate_over_usd: 150, blocked_categories: ["crypto"] },
      seats: [
        { name: "paid-search-agent", holder: "Grace O'Connor", role: "media-buyer" },
        { name: "lifecycle-agent", holder: "Ibrahim Al-Sayed", role: "marketer" },
        { name: "brand-agent", holder: "Yuki Tanaka", role: "designer" },
        { name: "growth-analyst-agent", holder: "Paula Marković", role: "analyst" },
      ],
    },
    {
      name: "Demo — Meridian / Revenue Operations",
      policy: { daily_spend_budget_usd: 900, daily_token_budget_usd: 40, subtree_daily_token_cap_usd: 200, per_transaction_max_usd: 500, auto_approve_under_usd: 50, escalate_over_usd: 200 },
      seats: [
        { name: "forecast-agent", holder: "Hassan Farah", role: "ops" },
        { name: "crm-agent", holder: "Ana Beatriz Lima", role: "ops" },
        { name: "billing-ops-agent", holder: "Sven Johansson", role: "analyst" },
        { name: "deal-desk-agent", holder: "Fatima Zahra", role: "ops" },
      ],
    },
  ],
  history: (day: number): DayPlan => {
    const weekday = isWeekday(day)
    const plan: DayPlan = { tokens: [], spends: [] }
    // Departments hum along under their caps — the month the reporting page
    // and the sequential simulator replay.
    plan.tokens.push(
      { seat: "ci-agent", model: "claude-haiku-4-5", tokens_in: 380_000, tokens_out: 50_000, cost_usd: 5.8 + (day % 3) * 0.4, task: "test-triage" },
      { seat: "code-review-agent", model: "claude-sonnet-4-6", tokens_in: 900_000, tokens_out: 130_000, cost_usd: 11 + (day % 4) * 0.5, task: "pr-review" },
      { seat: "infra-agent", model: "gpt-4o", tokens_in: 700_000, tokens_out: 100_000, cost_usd: 11.5, task: "terraform-plan-review" },
      { seat: "content-agent", model: "claude-sonnet-4-6", tokens_in: 300_000, tokens_out: 70_000, cost_usd: 5.2, task: "campaign-copy" },
      { seat: "seo-agent", model: "gemini-2.5-pro", tokens_in: 250_000, tokens_out: 30_000, cost_usd: 2.4, task: "serp-analysis" },
      { seat: "triage-agent", model: "claude-haiku-4-5", tokens_in: 200_000, tokens_out: 24_000, cost_usd: 1.8, task: "ticket-triage" },
    )
    if (weekday) {
      plan.spends.push({ seat: "infra-agent", action: "purchase", amount_usd: 16 + (day % 4), merchant: "AWS", category: "infrastructure", description: "Spot capacity for the nightly build farm", expect: "approved" })
      if (day % 7 === 4)
        plan.spends.push({ seat: "infra-agent", action: "subscribe", amount_usd: 60, merchant: "Datadog", category: "infrastructure", description: "APM host expansion", expect: "approved" })
      if (day % 10 === 5)
        plan.spends.push({ seat: "infra-agent", action: "purchase", amount_usd: 140, merchant: "Lambda Labs", category: "infrastructure", description: "GPU reservation for the eval run", expect: "escalated", then: "approve-and-redeem" })
      if (day % 5 === 0)
        plan.spends.push({ seat: "content-agent", action: "purchase", amount_usd: 22 + (day % 3) * 4, merchant: "Canva", category: "marketing", description: "Asset pack", expect: "approved" })
      if (day % 9 === 3)
        plan.spends.push({ seat: "seo-agent", action: "purchase", amount_usd: 30, merchant: "CoinGecko Pro", category: "crypto", description: "Price API tier", expect: "denied" })
      if (day % 6 === 2)
        plan.spends.push({ seat: "triage-agent", action: "purchase", amount_usd: 12, merchant: "Zendesk", category: "software", description: "Sandbox add-on", expect: "approved" })
    }
    return plan
  },
  pulse: {
    tokens: [
      // Engineering: 9.60 + 19 + 19 = 47.60 of the 55 pooled cap ≈ 87%.
      { seat: "ci-agent", model: "claude-haiku-4-5", tokens_in: 310_000, tokens_out: 42_000, cost_usd: 4.8, task: "test-triage" },
      { seat: "ci-agent", model: "claude-haiku-4-5", tokens_in: 300_000, tokens_out: 41_000, cost_usd: 4.8, task: "flaky-retry-analysis" },
      // one more page of CI logs and the seat's own $10 line says no:
      { seat: "ci-agent", model: "claude-haiku-4-5", tokens_in: 90_000, tokens_out: 12_000, cost_usd: 1.5, task: "test-triage", expectDenied: true },
      { seat: "code-review-agent", model: "claude-sonnet-4-6", tokens_in: 800_000, tokens_out: 120_000, cost_usd: 9.5, task: "pr-review" },
      { seat: "code-review-agent", model: "claude-sonnet-4-6", tokens_in: 790_000, tokens_out: 118_000, cost_usd: 9.5, task: "pr-review" },
      { seat: "infra-agent", model: "gpt-4o", tokens_in: 600_000, tokens_out: 90_000, cost_usd: 9.5, task: "terraform-plan-review" },
      { seat: "infra-agent", model: "gpt-4o", tokens_in: 590_000, tokens_out: 89_000, cost_usd: 9.5, task: "incident-summary" },
      // Marketing + Support: healthy, unremarkable burn.
      { seat: "content-agent", model: "claude-sonnet-4-6", tokens_in: 420_000, tokens_out: 95_000, cost_usd: 7.1, task: "campaign-copy" },
      { seat: "seo-agent", model: "gemini-2.5-pro", tokens_in: 350_000, tokens_out: 40_000, cost_usd: 3.4, task: "serp-analysis" },
      { seat: "triage-agent", model: "claude-haiku-4-5", tokens_in: 260_000, tokens_out: 30_000, cost_usd: 2.2, task: "ticket-triage" },
      { seat: "kb-agent", model: "claude-haiku-4-5", tokens_in: 180_000, tokens_out: 22_000, cost_usd: 1.6, task: "kb-answer" },
    ],
    spends: [
      { seat: "infra-agent", action: "purchase", amount_usd: 18, merchant: "AWS", category: "infrastructure", description: "Spot capacity for the nightly build farm", expect: "approved" },
      { seat: "infra-agent", action: "subscribe", amount_usd: 60, merchant: "Datadog", category: "infrastructure", description: "APM host expansion", expect: "approved" },
      { seat: "infra-agent", action: "purchase", amount_usd: 140, merchant: "Lambda Labs", category: "infrastructure", description: "GPU reservation for the eval run", expect: "escalated", then: "leave-pending" },
      { seat: "infra-agent", action: "purchase", amount_usd: 620, merchant: "Dell", category: "infrastructure", description: "Refurb rack server", expect: "denied" },
      { seat: "content-agent", action: "purchase", amount_usd: 45, merchant: "Canva", category: "marketing", description: "Brand kit renewal", expect: "approved" },
      { seat: "content-agent", action: "purchase", amount_usd: 250, merchant: "LinkedIn Ads", category: "marketing", description: "Q3 pipeline campaign", expect: "escalated", then: "approve-and-redeem" },
      { seat: "seo-agent", action: "purchase", amount_usd: 30, merchant: "CoinGecko Pro", category: "crypto", description: "Price API tier", expect: "denied" },
      { seat: "triage-agent", action: "purchase", amount_usd: 12, merchant: "Zendesk", category: "software", description: "Sandbox add-on", expect: "approved" },
    ],
    tools: [
      { seat: "kb-agent", tool: "kb.search", server: "knowledge", expect: "allowed" },
      { seat: "triage-agent", tool: "email.send", server: "gmail", expect: "escalated", then: "leave-pending" },
      { seat: "triage-agent", tool: "shell.exec", server: "ops-box", expect: "denied" },
    ],
    injections: [{ seat: "infra-agent", label: "OPENAI_API_KEY", budget_usd: 25 }],
  },
}
