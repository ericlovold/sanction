// Demo — Harbor & Wren LLP: the regulated-practice story. Tight ladders,
// clearance-gated vault access, a contractor whose seat already failed
// closed, and the closer: a signed audit export the assessor verifies.
//
// Staged end-state after `history` + `pulse`:
//   · contract-agent (contractor, rolled off) — key fails closed 401 on stage
//   · docket-agent injects the clearance-3 DOCKET_API_KEY under a scoped JWT
//   · an expert-witness retainer escalation LEFT PENDING (the partner decides)
//   · a docusign.send tool escalation LEFT PENDING
//   · a month of research burn + small filings, one approved retainer a week

import { isWeekday } from "../lib"
import type { Persona, DayPlan } from "../lib"

const CORPORATE = "Demo — Harbor & Wren / Practice — Corporate"
const LITIGATION = "Demo — Harbor & Wren / Practice — Litigation"

export const harborwren: Persona = {
  key: "harborwren",
  company: "Demo — Harbor & Wren LLP",
  companyPolicy: {
    allowed_categories: ["software", "services", "research", "legal"],
    daily_spend_budget_usd: 2000,
    daily_token_budget_usd: 80,
    per_transaction_max_usd: 1000,
    auto_approve_under_usd: 40,
    escalate_over_usd: 120,
    escalation_timeout_mins: 480, // partners decide on partner time
    escalation_timeout_action: "deny",
  },
  pools: [
    {
      name: CORPORATE,
      policy: {
        allowed_categories: ["software", "services", "legal"],
        daily_spend_budget_usd: 500,
        daily_token_budget_usd: 25,
        per_transaction_max_usd: 400,
        auto_approve_under_usd: 25,
        escalate_over_usd: 100,
        escalate_tools: ["docusign.send", "email.send"],
        blocked_tools: ["social.post"],
      },
      seats: [
        { name: "paralegal-agent", holder: "M. Whitfield" },
        // The contractor who rolled off: seed creates this seat already
        // expired, so the key fails closed on both auth planes — live.
        { name: "contract-agent", holder: "R. Osei (contract)", expiresAt: "past" },
      ],
    },
    {
      name: LITIGATION,
      policy: {
        allowed_categories: ["software", "services", "research", "legal"],
        daily_spend_budget_usd: 800,
        daily_token_budget_usd: 40,
        per_transaction_max_usd: 600,
        auto_approve_under_usd: 30,
        escalate_over_usd: 150,
      },
      seats: [
        { name: "docket-agent", holder: "J. Arceneaux", overrides: { clearance: 3, industry: "legal" } },
        { name: "discovery-agent", holder: "P. Lindgren" },
      ],
      vault: [
        { label: "DOCKET_API_KEY", type: "api_key", value: "demo-not-a-real-key-docket", min_clearance: 3 },
        { label: "WESTLAW_API_KEY", type: "api_key", value: "demo-not-a-real-key-westlaw", min_clearance: 3 },
      ],
    },
  ],
  history: (day: number): DayPlan => {
    const weekday = isWeekday(day)
    const plan: DayPlan = { tokens: [], spends: [] }
    if (!weekday) return plan // the firm rests
    plan.tokens.push(
      {
        seat: "discovery-agent",
        model: "claude-sonnet-4-6",
        tokens_in: 500_000 + (day % 4) * 40_000,
        tokens_out: 60_000,
        cost_usd: 6.8 + (day % 4) * 0.4,
        task: "privilege-screen",
      },
      {
        seat: "paralegal-agent",
        model: "claude-haiku-4-5",
        tokens_in: 200_000,
        tokens_out: 25_000,
        cost_usd: 1.9,
        task: "clause-comparison",
      },
    )
    plan.spends.push({
      seat: "docket-agent",
      action: "purchase",
      amount_usd: 12 + (day % 3) * 2,
      merchant: "PACER",
      category: "legal",
      description: "Docket pulls",
      expect: "approved",
    })
    if (day % 7 === 2)
      plan.spends.push({
        seat: "discovery-agent",
        action: "purchase",
        amount_usd: 180,
        merchant: "Veritext",
        category: "legal",
        description: "Deposition transcript",
        expect: "escalated",
        then: "approve-and-redeem", // the partner approved it that day
      })
    return plan
  },
  pulse: {
    expiredSeats: ["contract-agent"],
    tokens: [
      { seat: "discovery-agent", model: "claude-sonnet-4-6", tokens_in: 520_000, tokens_out: 62_000, cost_usd: 7.1, task: "privilege-screen" },
      { seat: "paralegal-agent", model: "claude-haiku-4-5", tokens_in: 210_000, tokens_out: 26_000, cost_usd: 2.0, task: "clause-comparison" },
      { seat: "docket-agent", model: "claude-haiku-4-5", tokens_in: 90_000, tokens_out: 12_000, cost_usd: 0.9, task: "docket-summaries" },
    ],
    spends: [
      { seat: "docket-agent", action: "purchase", amount_usd: 14, merchant: "PACER", category: "legal", description: "Docket pulls", expect: "approved" },
      // The partner's call: expert-witness retainer waits in the inbox.
      { seat: "discovery-agent", action: "purchase", amount_usd: 450, merchant: "Rule 26 Experts LLC", category: "legal", description: "Expert witness retainer — Chen v. Meridian", expect: "escalated", then: "leave-pending" },
      // Over the litigation hard cap: denied, with the four-questions envelope.
      { seat: "discovery-agent", action: "purchase", amount_usd: 900, merchant: "Veritext", category: "legal", description: "Expedited full-trial transcript set", expect: "denied" },
    ],
    tools: [
      { seat: "paralegal-agent", tool: "docusign.send", server: "docusign", expect: "escalated", then: "leave-pending" },
      { seat: "paralegal-agent", tool: "social.post", server: "linkedin", expect: "denied" },
    ],
    injections: [{ seat: "docket-agent", label: "DOCKET_API_KEY", budget_usd: 15 }],
  },
}
