"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { getSessionWallet } from "@/lib/session"

// Resolve an agent only if it belongs to the logged-in wallet. Session-gated —
// same management-plane trust model as the REST endpoints (x-mgmt-key).
async function ownedAgent(agentId: string) {
  const wallet = await getSessionWallet()
  if (!wallet) return null
  const agent = await db.agent.findUnique({ where: { id: agentId } })
  if (!agent || agent.walletId !== wallet.id) return null
  return { wallet, agent }
}

export type RotateState = { ok: boolean; error: string; agentId?: string; newKey?: string }

// Rotate an agent's API key: mints a fresh pxy_ key, overwrites the stored hash
// (the old key stops working immediately), and returns the new key once.
export async function rotateKeyAction(_prev: RotateState, form: FormData): Promise<RotateState> {
  const agentId = String(form.get("agent_id") ?? "")
  const owned = await ownedAgent(agentId)
  if (!owned) return { ok: false, error: "Not authorized." }

  const key = generateApiKey()
  await db.agent.update({ where: { id: agentId }, data: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix } })
  revalidatePath("/dashboard/keys")
  return { ok: true, error: "", agentId, newKey: key.raw }
}

// Revoke (active=false) or reactivate (active=true) an agent's key. Form-action
// shaped (reads agent_id + active from the form) so it binds directly to a form.
export async function setAgentActiveAction(form: FormData): Promise<void> {
  const agentId = String(form.get("agent_id") ?? "")
  const active = String(form.get("active") ?? "") === "true"
  const owned = await ownedAgent(agentId)
  if (!owned) return
  await db.agent.update({ where: { id: agentId }, data: { isActive: active } })
  revalidatePath("/dashboard/keys")
}

// Empty string = inherit the wallet policy (null); a number = a per-agent
// override in dollars, stored as cents.
function toCentsOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim()
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

export type LimitsState = { ok: boolean; error: string }

// Set per-agent budget overrides + clearance level from the inline editor.
export async function updateLimitsAction(_prev: LimitsState, form: FormData): Promise<LimitsState> {
  const agentId = String(form.get("agent_id") ?? "")
  const owned = await ownedAgent(agentId)
  if (!owned) return { ok: false, error: "Not authorized." }

  await db.agent.update({
    where: { id: agentId },
    data: {
      dailyTokenBudgetUsd: toCentsOrNull(form.get("daily_token_budget_usd")),
      dailySpendBudgetUsd: toCentsOrNull(form.get("daily_spend_budget_usd")),
      perTransactionMaxUsd: toCentsOrNull(form.get("per_transaction_max_usd")),
      escalateOverUsd: toCentsOrNull(form.get("escalate_over_usd")),
    },
  })

  const clearance = Number(form.get("clearance") ?? "")
  if (Number.isInteger(clearance) && clearance >= 1 && clearance <= 5) {
    await db.agentClearance.upsert({
      where: { agentId },
      update: { level: clearance },
      create: { walletId: owned.wallet.id, agentId, level: clearance },
    })
  }

  revalidatePath("/dashboard/keys")
  return { ok: true, error: "" }
}
