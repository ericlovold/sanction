"use server"

import { revalidatePath } from "next/cache"
import { applyPolicyUpdate } from "@/lib/policy"
import { getSessionWallet } from "@/lib/session"

export type PolicyActionState = { ok: boolean; message: string }

// Categories are lowercased (case-insensitive spend policy); tools are NOT —
// they're case-sensitive, namespaced identifiers (e.g. github.create_deployment).
const parseList = (s: FormDataEntryValue | null, lower: boolean) =>
  String(s ?? "")
    .split(",")
    .map((c) => (lower ? c.trim().toLowerCase() : c.trim()))
    .filter(Boolean)

const num = (s: FormDataEntryValue | null) => {
  // Blank/missing → undefined (leave the field unchanged), NOT 0 — clearing a
  // guardrail input must never silently force it to $0. Number("") is 0.
  if (s === null || String(s).trim() === "") return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const optionalNum = (s: FormDataEntryValue | null) => {
  if (s === null || String(s).trim() === "") return null
  return num(s)
}

// The capability-rule repeater serializes its array to one hidden JSON input.
// We parse it here and hand the raw array to applyPolicyUpdate, letting the
// capabilityRules zod (≤200 rules, pattern ≤120, effect enum) be the single
// validator — no brittle indexed FormData keys. Returns undefined only when the
// field is absent; an empty array [] is a valid "clear all rules" state.
function parseCapabilityRules(s: FormDataEntryValue | null): unknown[] | undefined | "invalid" {
  if (s === null) return undefined
  try {
    const v = JSON.parse(String(s))
    return Array.isArray(v) ? v : "invalid"
  } catch {
    return "invalid"
  }
}

// The dashboard is already an owner-scoped session view (no key in the browser).
// Mutating that same wallet's policy server-side keeps the management key off the
// client. All 15 governed fields flow through applyPolicyUpdate → an immutable
// PolicyRevision (the evidentiary write path).
export async function updatePolicyAction(
  _prev: PolicyActionState,
  form: FormData,
): Promise<PolicyActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to edit your policy." }

  const capabilityRules = parseCapabilityRules(form.get("capability_rules"))
  if (capabilityRules === "invalid") return { ok: false, message: "Invalid capability rules." }

  const input = {
    daily_token_budget_usd: num(form.get("daily_token_budget_usd")),
    daily_spend_budget_usd: num(form.get("daily_spend_budget_usd")),
    monthly_spend_budget_usd: optionalNum(form.get("monthly_spend_budget_usd")),
    subtree_daily_cap_usd: optionalNum(form.get("subtree_daily_cap_usd")),
    per_transaction_max_usd: num(form.get("per_transaction_max_usd")),
    auto_approve_under_usd: num(form.get("auto_approve_under_usd")),
    escalate_over_usd: num(form.get("escalate_over_usd")),
    allowed_categories: parseList(form.get("allowed_categories"), true),
    blocked_categories: parseList(form.get("blocked_categories"), true),
    allowed_tools: parseList(form.get("allowed_tools"), false),
    blocked_tools: parseList(form.get("blocked_tools"), false),
    escalate_tools: parseList(form.get("escalate_tools"), false),
    ...(capabilityRules !== undefined ? { capability_rules: capabilityRules } : {}),
    escalation_timeout_mins: num(form.get("escalation_timeout_mins")),
    escalation_timeout_action: form.get("escalation_timeout_action")
      ? String(form.get("escalation_timeout_action"))
      : undefined,
  }

  const result = await applyPolicyUpdate(wallet.id, input)
  if (!result.ok) return { ok: false, message: result.error ?? "Update failed" }

  // Spend still reads policy for budgets/mix; Overview reads it for KPIs.
  revalidatePath("/dashboard/policy")
  revalidatePath("/dashboard/spend")
  revalidatePath("/dashboard")
  return { ok: true, message: "Policy saved" }
}
