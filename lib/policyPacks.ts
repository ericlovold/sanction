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
  channel?: "coding-agent" | "mcp" | "gateway" | "payments" | "agency"
  useCases?: string[]
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
  {
    id: "coding-agent-seat",
    name: "Coding agent seat",
    tagline: "Let coding agents read and propose freely; escalate writes, deploys, and new tools.",
    audience: "Cursor, Claude Code, Codex, Cline, and OpenHands agents moving from sandbox to real repos.",
    maturity: "governance",
    channel: "coding-agent",
    useCases: ["repository automation", "contractor seats", "pull-request agents"],
    policy: {
      auto_approve_under_usd: 3,
      escalate_over_usd: 25,
      per_transaction_max_usd: 150,
      daily_spend_budget_usd: 75,
      monthly_spend_budget_usd: 1000,
      daily_token_budget_usd: 40,
      blocked_categories: ["gambling", "adult", "weapons"],
      allowed_tools: ["github.read*", "linear.read*", "notion.read*"],
      escalate_tools: ["github.write*", "github.merge*", "shell:*", "deploy:*", "browser:submit*", "email:send*"],
      blocked_tools: ["cloud:delete*", "payments:*"],
      capability_rules: [
        { pattern: "skill:install:*", effect: "escalate" },
        { pattern: "plugin:add:*", effect: "escalate" },
        { pattern: "api:github.com/repos/*/actions/*", effect: "escalate" },
      ],
      escalation_timeout_mins: 240,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "mcp-tool-governance",
    name: "MCP tool governance",
    tagline: "Put allow, escalate, and deny rails around the MCP tools your agents discover.",
    audience: "Teams adding Sanction to Cursor, Claude Desktop, Claude Code, Windsurf, or custom MCP hosts.",
    maturity: "authorization",
    channel: "mcp",
    useCases: ["MCP host rollout", "tool approval", "agent marketplace governance"],
    policy: {
      auto_approve_under_usd: 2,
      escalate_over_usd: 20,
      per_transaction_max_usd: 100,
      daily_spend_budget_usd: 50,
      monthly_spend_budget_usd: 750,
      daily_token_budget_usd: 50,
      blocked_categories: ["gambling", "adult", "weapons", "crypto"],
      allowed_tools: ["search:*", "read:*", "github.read*", "filesystem.read*"],
      escalate_tools: ["filesystem.write*", "github.write*", "shell:*", "browser:submit*", "email:send*", "deploy:*"],
      blocked_tools: ["secrets:read_raw", "cloud:delete*", "payments:*"],
      capability_rules: [
        { pattern: "mcp:server:add:*", effect: "escalate" },
        { pattern: "tool:invoke:shell:*", effect: "escalate" },
        { pattern: "api:*/delete*", effect: "block" },
      ],
      escalation_timeout_mins: 180,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "gateway-token-budget",
    name: "Gateway token budget",
    tagline: "Start with model-call metering and a hard stop before the provider sees over-budget traffic.",
    audience: "Teams already using LiteLLM, Vercel AI SDK, OpenAI-compatible clients, or a homegrown LLM gateway.",
    maturity: "metering",
    channel: "gateway",
    useCases: ["token budgets", "multi-provider metering", "LLM gateway pilots"],
    policy: {
      auto_approve_under_usd: 1_000_000,
      escalate_over_usd: 1_000_000,
      per_transaction_max_usd: 1_000_000,
      daily_spend_budget_usd: 1_000_000,
      monthly_spend_budget_usd: null,
      daily_token_budget_usd: 25,
      blocked_categories: [],
      allowed_tools: [],
      blocked_tools: [],
      escalate_tools: [],
      capability_rules: [],
      escalation_timeout_mins: 0,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "fleet-channel-envelope",
    name: "Fleet channel envelope",
    tagline: "The pool policy for one spending channel of an agent fleet — monthly envelope, pooled token cap, escalation line, outcome-ceiling ready.",
    audience:
      "Ops running a fleet where channels (paid media, content, outbound) are delegated pools and every seat spends. Apply to the channel pool, not the root; set outcome_kind + a ceiling once you report outcomes.",
    maturity: "governance",
    channel: "agency",
    useCases: ["agent fleets", "channel budgets", "department chargeback"],
    policy: {
      auto_approve_under_usd: 50,
      escalate_over_usd: 250,
      per_transaction_max_usd: 1_000,
      daily_spend_budget_usd: 4_000,
      monthly_spend_budget_usd: 120_000,
      subtree_daily_cap_usd: 5_000,
      daily_token_budget_usd: 25,
      monthly_token_budget_usd: 500,
      subtree_daily_token_cap_usd: 500,
      blocked_categories: ["gambling", "adult", "weapons", "crypto"],
      allowed_tools: [],
      blocked_tools: ["payments:*", "secrets:export*"],
      escalate_tools: ["provision:*"],
      capability_rules: [
        { pattern: "skill:install:*", effect: "escalate" },
        { pattern: "plugin:add:*", effect: "escalate" },
      ],
      escalation_timeout_mins: 240,
      escalation_timeout_action: "deny",
      // CPO-1 knobs ship pre-wired but off: fill outcome_kind + ceiling when
      // the operator starts reporting outcomes (POST /outcomes).
      outcome_kind: null,
      cost_per_outcome_ceiling_usd: null,
      cost_per_outcome_window_days: 30,
      cost_per_outcome_min_outcomes: 5,
    },
  },
  {
    id: "agency-client-safe-launch",
    name: "Client-safe launch",
    tagline: "A launch policy an AI agency can hand to a client: visible spend, approval for risky work, evidence after.",
    audience: "AI agencies and consultants shipping agents into client accounts this week.",
    maturity: "evidence",
    channel: "agency",
    useCases: ["client delivery", "pilot checklist", "weekly client report"],
    policy: {
      auto_approve_under_usd: 5,
      escalate_over_usd: 30,
      per_transaction_max_usd: 250,
      daily_spend_budget_usd: 100,
      monthly_spend_budget_usd: 1200,
      daily_token_budget_usd: 75,
      blocked_categories: ["gambling", "adult", "weapons", "crypto"],
      allowed_tools: ["read:*", "search:*", "crm.read*", "github.read*", "notion.read*"],
      escalate_tools: ["crm.write*", "github.write*", "email:send*", "calendar:create*", "browser:submit*", "provision:*"],
      blocked_tools: ["payments:*", "cloud:delete*", "secrets:export*"],
      capability_rules: [
        { pattern: "skill:install:*", effect: "escalate" },
        { pattern: "plugin:add:*", effect: "escalate" },
        { pattern: "api:*", effect: "escalate" },
      ],
      escalation_timeout_mins: 480,
      escalation_timeout_action: "deny",
    },
  },
  {
    id: "payment-agent-mandate",
    name: "Payment agent mandate",
    tagline: "Hold policy and evidence in front of whichever payment rail the agent uses.",
    audience: "AP2, x402, checkout, procurement, and purchasing-agent pilots where money movement needs a mandate.",
    maturity: "evidence",
    channel: "payments",
    useCases: ["agent payments", "mandate authority", "purchase approvals"],
    policy: {
      auto_approve_under_usd: 0,
      escalate_over_usd: 0,
      per_transaction_max_usd: 100,
      daily_spend_budget_usd: 100,
      monthly_spend_budget_usd: 1000,
      daily_token_budget_usd: 25,
      allowed_categories: ["software", "infrastructure", "research"],
      blocked_categories: ["gambling", "adult", "weapons", "crypto"],
      allowed_tools: ["payments:quote*", "vendor:read*", "receipt:read*"],
      escalate_tools: ["payments:authorize*", "payments:capture*", "vendor:create*", "purchase:*"],
      blocked_tools: ["payments:refund*", "payments:wire*", "crypto:*"],
      capability_rules: [
        { pattern: "api:stripe.com/*", effect: "escalate" },
        { pattern: "api:coinbase.com/*", effect: "block" },
        { pattern: "payment-rail:*", effect: "escalate" },
      ],
      escalation_timeout_mins: 1440,
      escalation_timeout_action: "deny",
    },
  },
]

export function findPack(id: string): PolicyPack | null {
  return POLICY_PACKS.find((p) => p.id === id) ?? null
}
