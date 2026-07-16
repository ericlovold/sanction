"use server"

import { revalidatePath } from "next/cache"
import { applyPolicyUpdate, type PolicyInput } from "@/lib/policy"
import { findPack } from "@/lib/policyPacks"
import { runSimulation } from "@/lib/simulationRun"
import { rangeUtc } from "@/lib/reporting"
import { getSessionWallet, requireSessionRole } from "@/lib/session"

export type PolicyActionState = { ok: boolean; message: string }

// The honesty envelope runSimulation returns, carried back to the client so the
// report panel can render it verbatim (as_recorded, ignored_fields, truncated…).
export type SimulationReport = Awaited<ReturnType<typeof runSimulation>>
export type SimActionState = { ok: boolean; message: string; report?: SimulationReport; packName?: string }

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

// One parser for the full 15-field editor form, shared by save and draft
// simulation so the two can never read the form differently. Returns an error
// string only for a malformed capability payload (the sole client-side reject);
// everything else defers to applyPolicyUpdate / runSimulation.
function parsePolicyForm(form: FormData): { input: PolicyInput } | { error: string } {
  const capabilityRules = parseCapabilityRules(form.get("capability_rules"))
  if (capabilityRules === "invalid") return { error: "Invalid capability rules." }

  const input: PolicyInput = {
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
    ...(capabilityRules !== undefined ? { capability_rules: capabilityRules as PolicyInput["capability_rules"] } : {}),
    escalation_timeout_mins: num(form.get("escalation_timeout_mins")),
    escalation_timeout_action: form.get("escalation_timeout_action")
      ? (String(form.get("escalation_timeout_action")) as PolicyInput["escalation_timeout_action"])
      : undefined,
  }
  return { input }
}

// The dashboard is already an owner-scoped session view (no key in the browser).
// Mutating that same wallet's policy server-side keeps the management key off the
// client. All 15 governed fields flow through applyPolicyUpdate → an immutable
// PolicyRevision (the evidentiary write path).
export async function updatePolicyAction(
  _prev: PolicyActionState,
  form: FormData,
): Promise<PolicyActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to edit your policy." }

  const parsed = parsePolicyForm(form)
  if ("error" in parsed) return { ok: false, message: parsed.error }

  const result = await applyPolicyUpdate(wallet.id, parsed.input)
  if (!result.ok) return { ok: false, message: result.error ?? "Update failed" }

  // Spend still reads policy for budgets/mix; Overview reads it for KPIs.
  revalidatePath("/dashboard/policy")
  revalidatePath("/dashboard/spend")
  revalidatePath("/dashboard")
  return { ok: true, message: "Policy saved — your changes are live" }
}

// Default simulation windows mirror the API routes: draft = last 7 days,
// pack preview = last 30. Computed here (server-side, request time) — actions
// run on the server so Date is fine, unlike the pure simulation engine.
function windowEndingToday(daysBack: number): { start: Date; end: Date } {
  const today = new Date().toISOString().slice(0, 10)
  const back = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return rangeUtc(back, today)
}

// Preview a pack's effect on the recorded history — read + compute, NO write.
// The conversion moment: see what a curated baseline would have done to your
// last 30 days before committing to it. Left on getSessionWallet (no role
// floor): this is read-only, matching exactly what a viewer's role is for.
export async function previewPackAction(
  _prev: SimActionState,
  form: FormData,
): Promise<SimActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to preview a pack." }

  const pack = findPack(String(form.get("pack_id") ?? ""))
  if (!pack) return { ok: false, message: "Unknown pack." }

  const { start, end } = windowEndingToday(29)
  const report = await runSimulation(wallet.id, pack.policy, start, end)
  return { ok: true, message: "", report, packName: pack.name }
}

// Apply a pack: the ONE write path here. Destructive (a pack replaces the whole
// ladder) — the client gates it behind an explicit confirm. Flows through
// applyPolicyUpdate so it writes an immutable PolicyRevision like any change.
export async function applyPackAction(
  _prev: PolicyActionState,
  form: FormData,
): Promise<PolicyActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to apply a pack." }

  const pack = findPack(String(form.get("pack_id") ?? ""))
  if (!pack) return { ok: false, message: "Unknown pack." }

  const result = await applyPolicyUpdate(wallet.id, pack.policy)
  if (!result.ok) return { ok: false, message: result.error ?? "Apply failed" }

  revalidatePath("/dashboard/policy")
  revalidatePath("/dashboard/spend")
  revalidatePath("/dashboard")
  return { ok: true, message: `Applied "${pack.name}" — your policy is now live` }
}

// Simulate the editor's current draft before saving — the same full 15-field
// form as the save action, so the candidate is complete, never a partial patch.
// runSimulation's own envelope reports which fields it could overlay
// (applied_fields) and which it ignored (tool/provision ladders), so the report
// stays honest without a separate guard here — the editor always posts the
// category arrays, so there is always at least one simulatable field (unlike
// the JSON API route, whose body can omit them all). Read + compute, NO write
// — left on getSessionWallet like previewPackAction, no role floor.
export async function simulateDraftAction(
  _prev: SimActionState,
  form: FormData,
): Promise<SimActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to simulate a policy." }

  const parsed = parsePolicyForm(form)
  if ("error" in parsed) return { ok: false, message: parsed.error }

  const { start, end } = windowEndingToday(6)
  const report = await runSimulation(wallet.id, parsed.input, start, end)
  return { ok: true, message: "", report }
}
