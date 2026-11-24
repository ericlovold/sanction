import { fmtUsd } from "@/lib/format"

// The policy in a few plain sentences: what happens to a request right now.
// Each sentence restates a rule the decision engine applies (lib/rules/spend.ts,
// lib/rules/tool.ts, lib/rules/capability.ts); if a rule changes there, change
// the sentence here.

export type SummaryPolicy = {
  enforcement_mode?: string
  daily_token_budget_usd: number
  daily_spend_budget_usd: number
  monthly_spend_budget_usd: number | null
  monthly_token_budget_usd?: number | null
  subtree_daily_cap_usd?: number | null
  subtree_daily_token_cap_usd?: number | null
  per_transaction_max_usd: number
  auto_approve_under_usd: number
  escalate_over_usd: number
  allowed_categories: string[]
  blocked_categories: string[]
  allowed_tools: string[]
  blocked_tools: string[]
  escalate_tools: string[]
  capability_rules: unknown
  escalation_timeout_mins: number
  escalation_timeout_action: string
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function waitText(mins: number): string {
  if (mins < 60 || mins % 60 !== 0) return count(mins, "minute", "minutes")
  return count(mins / 60, "hour", "hours")
}

export function policySummary(p: SummaryPolicy): string[] {
  const out: string[] = []

  if (p.enforcement_mode === "observe") {
    out.push("Observe mode is on: requests go ahead whatever this policy decides, and each decision it would have made is recorded.")
  }

  // Daily and monthly limits are counted for each agent on its own
  // (app/api/v1/authorize/route.ts sums one agent's approved spend; the gateway
  // sums one agent's model cost). Only the two caps below pool agents together.
  // This summary sees the wallet's policy only, so it cannot name an agent's
  // own limit; it says that one may exist.
  const monthlyModel = p.monthly_token_budget_usd ?? null
  out.push(
    `Each agent's purchases stop at ${fmtUsd(p.daily_spend_budget_usd)} a day` +
      (p.monthly_spend_budget_usd !== null ? ` and ${fmtUsd(p.monthly_spend_budget_usd)} a month` : "") +
      `. Each agent's model spend stops at ${fmtUsd(p.daily_token_budget_usd)} a day` +
      (monthlyModel !== null ? ` and ${fmtUsd(monthlyModel)} a month` : "") +
      // Daily purchase and model-spend limits are defaults; monthly purchases
      // have no agent override. /authorize and the gateway read the
      // agent's own limit first (agent.dailySpendBudgetUsd ?? policy...).
      ". The daily purchase and model-spend limits are defaults; an agent’s own limit replaces the corresponding default.",
  )

  const pooledPurchases = p.subtree_daily_cap_usd ?? null
  const pooledModel = p.subtree_daily_token_cap_usd ?? null
  if (pooledPurchases !== null || pooledModel !== null) {
    out.push(
      "All agents in this wallet and the groups below it, together, stop at " +
        [
          pooledPurchases !== null ? `${fmtUsd(pooledPurchases)} a day in purchases` : "",
          pooledModel !== null ? `${fmtUsd(pooledModel)} a day in model spend` : "",
        ]
          .filter(Boolean)
          .join(" and ") +
        ".",
    )
  } else {
    out.push("This wallet sets no cap on all agents together, so the total grows with every agent added.")
  }

  // The ladder: over the single-purchase limit is refused; over the ask line a
  // person is asked; everything else inside the budgets goes through. The
  // always-approve amount wins over the ask line, so the line a person is
  // actually asked above is the larger of the two.
  const askAbove = Math.max(p.escalate_over_usd, p.auto_approve_under_usd)
  if (p.per_transaction_max_usd <= 0) {
    out.push("Every purchase is refused, because the largest single purchase is $0.00.")
  } else if (askAbove >= p.per_transaction_max_usd) {
    out.push(
      `Inside those limits, a purchase up to ${fmtUsd(p.per_transaction_max_usd)} goes through on its own and anything larger is refused. A person is never asked about a purchase.`,
    )
  } else {
    out.push(
      `Inside those limits, a purchase up to ${fmtUsd(askAbove)} goes through on its own. Above that, up to ${fmtUsd(p.per_transaction_max_usd)}, a person is asked. Anything larger is refused.`,
    )
  }

  if (p.blocked_categories.length > 0 || p.allowed_categories.length > 0) {
    out.push(
      [
        p.allowed_categories.length > 0 ? `Purchases are limited to ${count(p.allowed_categories.length, "category", "categories")}.` : "",
        p.blocked_categories.length > 0 ? `${count(p.blocked_categories.length, "category is", "categories are")} blocked.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
  }

  const tools = [
    p.allowed_tools.length > 0
      ? `Only ${count(p.allowed_tools.length, "named tool", "named tools")} may be used; any other tool is refused.`
      : "Any tool may be used unless it is listed below.",
    p.blocked_tools.length > 0 ? `${count(p.blocked_tools.length, "tool is", "tools are")} blocked.` : "",
    p.escalate_tools.length > 0 ? `${count(p.escalate_tools.length, "tool asks", "tools ask")} a person every time.` : "",
  ]
  out.push(tools.filter(Boolean).join(" "))

  const rules = Array.isArray(p.capability_rules) ? p.capability_rules.length : 0
  out.push(
    rules === 0
      ? "Taking on new capabilities (skills, plugins, new APIs) is not governed."
      : `${count(rules, "rule governs", "rules govern")} new capabilities (skills, plugins, new APIs).`,
  )

  out.push(
    p.escalation_timeout_mins === 0
      ? "When a person is asked, the request waits with no time limit."
      : `When a person is asked, the request waits up to ${waitText(p.escalation_timeout_mins)}, then is ${p.escalation_timeout_action === "approve" ? "approved" : "refused"}.`,
  )

  return out
}
