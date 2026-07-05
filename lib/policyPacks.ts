import type { PolicyInput } from "./policy"

// Policy packs (PACK-1): installable starting policies. Curated in code like
// the roadmap and changelog — each pack is a partial policy (dollars, the
// policy-update shape) plus the story of who it's for. Packs deliberately set
// ALL the ladder fields they care about: applying one is meant to be a
// coherent baseline, not a nudge. Preview before apply: every pack can be
// run through the retro-simulation to show what it would have done to your
// last 30 days — evidence before commitment.
//
// The ladder of packs mirrors the governance maturity ladder: watch first,
// then guardrails, then departmental governance, then fail-closed compliance.

export type PolicyPack = {
  id: string
  name: string
  tagline: string
  audience: string
  maturity: "metering" | "authorization" | "governance" | "evidence"
  policy: PolicyInput
}

export const POLICY_PACKS: PolicyPack[] = [
  {
    id: "metering-first",
    name: "Metering first",
    tagline: "Watch before you govern — everything passes, everything is measured.",
    audience: "Your first week with agents: see real spend patterns before choosing limits.",
    maturity: "metering",
    policy: {
      auto_approve_under_usd: 1_000_000,
      escalate_over_usd: 1_000_000,
      per_transaction_max_usd: 1_000_000,
      daily_spend_budget_usd: 1_000_000,
      monthly_spend_budget_usd: null,
      daily_token_budget_usd: 1_000_000,
      blocked_categories: [],
      capability_rules: [],
    },
  },
  {
    id: "startup-defaults",
    name: "Startup defaults",
    tagline: "Sane guardrails for a small team's first production agents.",
    audience: "A few agents doing real work; you want a ceiling, not a committee.",
    maturity: "authorization",
    policy: {
      auto_approve_under_usd: 5,
      escalate_over_usd: 50,
      per_transaction_max_usd: 200,
      daily_spend_budget_usd: 100,
      monthly_spend_budget_usd: 1500,
      daily_token_budget_usd: 50,
      blocked_categories: ["gambling", "adult"],
      capability_rules: [{ pattern: "skill:install:*", effect: "escalate" }],
      escalation_timeout_mins: 240,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "team-workspace",
    name: "Team workspace",
    tagline: "Departmental budgets, human escalation where it matters.",
    audience: "A team's shared wallet: real budgets, approvals for the unusual, room to work.",
    maturity: "governance",
    policy: {
      auto_approve_under_usd: 25,
      escalate_over_usd: 250,
      per_transaction_max_usd: 1000,
      daily_spend_budget_usd: 500,
      monthly_spend_budget_usd: 8000,
      daily_token_budget_usd: 200,
      blocked_categories: ["gambling", "adult"],
      capability_rules: [
        { pattern: "skill:install:*", effect: "escalate" },
        { pattern: "plugin:add:*", effect: "escalate" },
      ],
      escalation_timeout_mins: 480,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "compliance-baseline",
    name: "Compliance baseline",
    tagline: "Fail closed — everything above a whisper asks a human.",
    audience: "Regulated work: every spend escalates, every new capability escalates, timeouts deny.",
    maturity: "evidence",
    policy: {
      auto_approve_under_usd: 0,
      escalate_over_usd: 0,
      per_transaction_max_usd: 50,
      daily_spend_budget_usd: 25,
      monthly_spend_budget_usd: 300,
      daily_token_budget_usd: 25,
      blocked_categories: ["gambling", "adult", "weapons", "crypto"],
      capability_rules: [{ pattern: "*", effect: "escalate" }],
      escalation_timeout_mins: 1440,
      escalation_timeout_action: "deny",
    },
  },
]

export function findPack(id: string): PolicyPack | null {
  return POLICY_PACKS.find((p) => p.id === id) ?? null
}
