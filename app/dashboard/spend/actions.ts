"use server"

import { revalidatePath } from "next/cache"
import { applyPolicyUpdate } from "@/lib/policy"
import { requireSessionRole } from "@/lib/session"

export type PolicyActionState = { ok: boolean; message: string }

const parseCategories = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

const num = (s: FormDataEntryValue | null) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const optionalNum = (s: FormDataEntryValue | null) => {
  if (s === null || String(s).trim() === "") return null
  return num(s)
}

// The dashboard is already an env-scoped owner view (server-rendered for
// SANCTION_WALLET_ID, no key in the browser). Mutating that same wallet's policy
// server-side keeps the management key off the client.
export async function updatePolicyAction(
  _prev: PolicyActionState,
  form: FormData,
): Promise<PolicyActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to edit your policy." }

  const input = {
    daily_token_budget_usd: num(form.get("daily_token_budget_usd")),
    daily_spend_budget_usd: num(form.get("daily_spend_budget_usd")),
    subtree_daily_cap_usd: optionalNum(form.get("subtree_daily_cap_usd")),
    per_transaction_max_usd: num(form.get("per_transaction_max_usd")),
    auto_approve_under_usd: num(form.get("auto_approve_under_usd")),
    escalate_over_usd: num(form.get("escalate_over_usd")),
    allowed_categories: parseCategories(form.get("allowed_categories")),
    blocked_categories: parseCategories(form.get("blocked_categories")),
  }

  const result = await applyPolicyUpdate(wallet.id, input)
  if (!result.ok) return { ok: false, message: result.error ?? "Update failed" }

  revalidatePath("/dashboard/spend")
  revalidatePath("/dashboard")
  return { ok: true, message: "Policy saved" }
}
