"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { generateApiKey, generateManagementKey } from "@/lib/apiKey"
import { requireSessionRole, setSession } from "@/lib/session"

// Resolve an agent only if it belongs to the logged-in wallet, at an admin-or-
// higher role — same management-plane trust model as the REST endpoints
// (x-mgmt-key), plus the WALLET-MEMBERS role floor (a viewer can look but not touch).
async function ownedAgent(agentId: string) {
  const wallet = await requireSessionRole("admin")
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
  const holderRaw = String(form.get("holder") ?? "").trim()
  const changeHolder = String(form.get("change_holder") ?? "") === "true"

  const key = generateApiKey()
  await db.agent.update({
    where: { id: agentId },
    data: {
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      ...(changeHolder ? { holder: holderRaw ? holderRaw.slice(0, 120) : null } : {}),
    },
  })
  revalidatePath("/dashboard/agents")
  revalidatePath("/dashboard/keys")
  return { ok: true, error: "", agentId, newKey: key.raw }
}

export type MgmtKeyState = { ok: boolean; error: string; newKey?: string }

// Reset the wallet's MASTER management key (sk_ — the admin key that gates agent
// creation, policy, vault, and the whole management plane). Session-gated: the
// logged-in owner is proven by the session, so no old key is required — this is
// exactly the "I lost my admin key" recovery a user must be able to self-serve.
// The old key stops working the instant the new hash is stored; we re-set the
// session to the new key so the current login survives the rotation. Shown once.
export async function resetManagementKeyAction(_prev: MgmtKeyState, _form: FormData): Promise<MgmtKeyState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, error: "Log in to reset your management key." }

  const key = generateManagementKey()
  await db.wallet.update({
    where: { id: wallet.id },
    data: { mgmtKeyHash: key.hash, mgmtKeyPrefix: key.prefix },
  })
  // Keep this browser logged in after the rotation (the legacy session cookie
  // holds the raw key; Better Auth sessions are unaffected but this is harmless).
  await setSession(key.raw)

  revalidatePath("/dashboard/keys")
  return { ok: true, error: "", newKey: key.raw }
}

// Revoke (active=false) or reactivate (active=true) an agent's key. Form-action
// shaped (reads agent_id + active from the form) so it binds directly to a form.
export async function setAgentActiveAction(form: FormData): Promise<void> {
  const agentId = String(form.get("agent_id") ?? "")
  const active = String(form.get("active") ?? "") === "true"
  const owned = await ownedAgent(agentId)
  if (!owned) return
  await db.agent.update({ where: { id: agentId }, data: { isActive: active } })
  revalidatePath("/dashboard/agents")
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

  // Seat fields: empty string clears (holder removed / no auto-expiry).
  const holderRaw = String(form.get("holder") ?? "").trim()
  const expiresRaw = String(form.get("expires_at") ?? "").trim()

  await db.agent.update({
    where: { id: agentId },
    data: {
      dailyTokenBudgetUsd: toCentsOrNull(form.get("daily_token_budget_usd")),
      dailySpendBudgetUsd: toCentsOrNull(form.get("daily_spend_budget_usd")),
      perTransactionMaxUsd: toCentsOrNull(form.get("per_transaction_max_usd")),
      escalateOverUsd: toCentsOrNull(form.get("escalate_over_usd")),
      holder: holderRaw ? holderRaw.slice(0, 120) : null,
      expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? new Date(`${expiresRaw}T23:59:59`) : null,
    },
  })

  const clearance = Number(form.get("clearance") ?? "")
  if (Number.isInteger(clearance) && clearance >= 1 && clearance <= 5) {
    // RLS-scoped (SEC-3): AgentClearance is FORCE RLS — an unwrapped upsert
    // would be rejected by the policy now that the table fails closed.
    await withTenant(owned.wallet.id, (tx) =>
      tx.agentClearance.upsert({
        where: { agentId },
        update: { level: clearance },
        create: { walletId: owned.wallet.id, agentId, level: clearance },
      }),
    )
  }

  revalidatePath("/dashboard/agents")
  revalidatePath("/dashboard/keys")
  return { ok: true, error: "" }
}
