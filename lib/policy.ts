import { z } from "zod"
import { db } from "./db"

// Policy is stored in cents; the API and UI speak dollars. This module is the
// single place that validates input, converts dollars -> cents, and writes —
// shared by the REST endpoint (x-mgmt-key) and the dashboard server action so
// the two can never drift.

const dollars = z.number().min(0).max(1_000_000)
const categories = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(50)
// Tool names are case-sensitive and may be namespaced (e.g. github.create_deployment).
const tools = z.array(z.string().trim().min(1).max(80)).max(200)

export const policyInputSchema = z
  .object({
    daily_token_budget_usd: dollars,
    daily_spend_budget_usd: dollars,
    per_transaction_max_usd: dollars,
    auto_approve_under_usd: dollars,
    escalate_over_usd: dollars,
    allowed_categories: categories,
    blocked_categories: categories,
    allowed_tools: tools,
    blocked_tools: tools,
    escalate_tools: tools,
    escalation_timeout_mins: z.number().int().min(0).max(10_080), // 0 = never; cap 7 days
    escalation_timeout_action: z.enum(["deny", "approve"]),
  })
  .partial()

export type PolicyInput = z.infer<typeof policyInputSchema>

const toCents = (n: number) => Math.round(n * 100)

/** Validate a partial policy update, convert to cents, and upsert it. Returns the policy in dollars. */
export async function applyPolicyUpdate(walletId: string, input: unknown) {
  const parsed = policyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid policy", details: parsed.error.flatten() }
  }
  const d = parsed.data

  const data: Record<string, unknown> = {}
  if (d.daily_token_budget_usd !== undefined) data.dailyTokenBudgetUsd = toCents(d.daily_token_budget_usd)
  if (d.daily_spend_budget_usd !== undefined) data.dailySpendBudgetUsd = toCents(d.daily_spend_budget_usd)
  if (d.per_transaction_max_usd !== undefined) data.perTransactionMaxUsd = toCents(d.per_transaction_max_usd)
  if (d.auto_approve_under_usd !== undefined) data.autoApproveUnderUsd = toCents(d.auto_approve_under_usd)
  if (d.escalate_over_usd !== undefined) data.escalateOverUsd = toCents(d.escalate_over_usd)
  if (d.allowed_categories !== undefined) data.allowedCategories = d.allowed_categories
  if (d.blocked_categories !== undefined) data.blockedCategories = d.blocked_categories
  if (d.allowed_tools !== undefined) data.allowedTools = d.allowed_tools
  if (d.blocked_tools !== undefined) data.blockedTools = d.blocked_tools
  if (d.escalate_tools !== undefined) data.escalateTools = d.escalate_tools
  if (d.escalation_timeout_mins !== undefined) data.escalationTimeoutMins = d.escalation_timeout_mins
  if (d.escalation_timeout_action !== undefined) data.escalationTimeoutAction = d.escalation_timeout_action

  if (Object.keys(data).length === 0) {
    return { ok: false as const, error: "No fields to update" }
  }

  const policy = await db.policy.upsert({
    where: { walletId },
    update: data,
    create: { walletId, ...data },
  })

  return { ok: true as const, policy: policyToDollars(policy) }
}

type PolicyRow = {
  dailyTokenBudgetUsd: number
  dailySpendBudgetUsd: number
  perTransactionMaxUsd: number
  autoApproveUnderUsd: number
  escalateOverUsd: number
  allowedCategories: string[]
  blockedCategories: string[]
  allowedTools: string[]
  blockedTools: string[]
  escalateTools: string[]
  escalationTimeoutMins: number
  escalationTimeoutAction: string
}

export function policyToDollars(p: PolicyRow) {
  return {
    daily_token_budget_usd: p.dailyTokenBudgetUsd / 100,
    daily_spend_budget_usd: p.dailySpendBudgetUsd / 100,
    per_transaction_max_usd: p.perTransactionMaxUsd / 100,
    auto_approve_under_usd: p.autoApproveUnderUsd / 100,
    escalate_over_usd: p.escalateOverUsd / 100,
    allowed_categories: p.allowedCategories,
    blocked_categories: p.blockedCategories,
    allowed_tools: p.allowedTools,
    blocked_tools: p.blockedTools,
    escalate_tools: p.escalateTools,
    escalation_timeout_mins: p.escalationTimeoutMins,
    escalation_timeout_action: p.escalationTimeoutAction,
  }
}
