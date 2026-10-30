// Keep the Demo Pulse CPO assertion deterministic: a throttled channel's
// windowed spend/outcomes age out of the 30-day ceiling, and the next probe
// would auto-approve. Before asserting, re-arm that window with idempotent,
// demo-org-scoped writes (timestamps relative to now) if it is not already
// going to escalate. The probe spend still has to trip COST_PER_OUTCOME_CEILING
// — this does not weaken the check into an always-pass.

import { call } from "./lib"
import type { Keys, Persona, SpendSpec } from "./lib"

export type CpoWindow = {
  windowSpendUsd: number
  windowOutcomes: number
  minOutcomes: number
  ceilingUsd: number
}

export type CpoSummary = {
  outcomes: number
  windowSpendUsd: number
  ceilingUsd: number | null
  governed: boolean
}

export type CpoArmPlan =
  | { kind: "already_armed" }
  | { kind: "arm"; spendAmounts: number[]; outcomeCount: number }
  | { kind: "impossible"; reason: string }

/** Same inequality `costPerOutcomeRule` uses in lib/rules/spend.ts. */
export function wouldCpoEscalate(window: CpoWindow, chargeUsd: number): boolean {
  if (window.windowOutcomes < window.minOutcomes) return false
  const projectedSpendCents = Math.round((window.windowSpendUsd + chargeUsd) * 100)
  const ceilingCents = Math.round(window.ceilingUsd * 100)
  return projectedSpendCents > ceilingCents * window.windowOutcomes
}

export function parseCpoSummary(json: unknown, walletId: string): CpoSummary | string {
  if (!json || typeof json !== "object") return "malformed CPO summary"
  const o = json as Record<string, unknown>
  if (o.wallet_id !== walletId) return "CPO summary wallet_id mismatch"
  if (typeof o.outcomes !== "number" || !Number.isInteger(o.outcomes) || o.outcomes < 0) {
    return "CPO summary missing outcomes"
  }
  if (typeof o.window_spend_usd !== "number" || !Number.isFinite(o.window_spend_usd) || o.window_spend_usd < 0) {
    return "CPO summary missing window_spend_usd"
  }
  if (o.ceiling_usd !== null && (typeof o.ceiling_usd !== "number" || !Number.isFinite(o.ceiling_usd) || o.ceiling_usd < 0)) {
    return "CPO summary missing ceiling_usd"
  }
  if (typeof o.governed !== "boolean") return "CPO summary missing governed"
  return {
    outcomes: o.outcomes,
    windowSpendUsd: o.window_spend_usd,
    ceilingUsd: o.ceiling_usd,
    governed: o.governed,
  }
}

function dollars(cents: number): number {
  return cents / 100
}

/** Approved chunks that land windowed spend in the (ceiling×outcomes − charge, ceiling×outcomes] gap. */
export function gapSpends(window: CpoWindow, chargeUsd: number, autoApproveUnderUsd: number): number[] | null {
  const ceilingCents = Math.round(window.ceilingUsd * 100)
  const allowance = ceilingCents * window.windowOutcomes
  const chargeCents = Math.round(chargeUsd * 100)
  const current = Math.round(window.windowSpendUsd * 100)
  const target = allowance - chargeCents + 1
  if (current >= target) return []
  if (target > allowance) return null
  const need = target - current
  const maxChunk = Math.round(autoApproveUnderUsd * 100)
  if (maxChunk <= 0) return null
  const amounts: number[] = []
  let remaining = need
  let spent = current
  while (remaining > 0) {
    const room = Math.min(maxChunk, allowance - spent, remaining)
    if (room <= 0) return null
    amounts.push(dollars(room))
    spent += room
    remaining -= room
  }
  return amounts
}

export function planCpoArm(
  window: CpoWindow,
  chargeUsd: number,
  opts: { autoApproveUnderUsd: number; primeSpendAmounts: number[] },
): CpoArmPlan {
  if (!(window.ceilingUsd > 0)) return { kind: "impossible", reason: "CPO ceiling is missing" }
  if (wouldCpoEscalate(window, chargeUsd)) return { kind: "already_armed" }

  const missingOutcomes = Math.max(0, window.minOutcomes - window.windowOutcomes)
  const withMinOutcomes: CpoWindow = { ...window, windowOutcomes: window.windowOutcomes + missingOutcomes }

  // Reaching min_outcomes on leftover spend is enough — don't add outcomes that would dilute.
  if (missingOutcomes > 0 && wouldCpoEscalate(withMinOutcomes, chargeUsd)) {
    return { kind: "arm", spendAmounts: [], outcomeCount: missingOutcomes }
  }

  if (missingOutcomes > 0) {
    const added = opts.primeSpendAmounts.reduce((a, b) => a + b, 0)
    const next: CpoWindow = {
      ...withMinOutcomes,
      windowSpendUsd: window.windowSpendUsd + added,
    }
    if (!wouldCpoEscalate(next, chargeUsd)) {
      return {
        kind: "impossible",
        reason: `prime spends ($${added}) cannot arm the ceiling at ${next.windowOutcomes} outcomes`,
      }
    }
    return { kind: "arm", spendAmounts: opts.primeSpendAmounts, outcomeCount: missingOutcomes }
  }

  const chunks = gapSpends(window, chargeUsd, opts.autoApproveUnderUsd)
  if (!chunks) {
    return {
      kind: "impossible",
      reason: "cannot add approved spend without crossing the ceiling before the probe charge",
    }
  }
  return { kind: "arm", spendAmounts: chunks, outcomeCount: 0 }
}

type Probe = {
  seat: string
  amountUsd: number
  kind: string
  minOutcomes: number
  autoApproveUnderUsd: number
  windowDays: number
}

function resolveProbe(persona: Persona, keys: Keys): Probe | string {
  if (!persona.prime) return "no prime plan"
  const primedSeats = new Set(persona.prime.spends.map((s) => s.seat))
  const spend = persona.pulse.spends.find((s) => s.expect === "escalated" && primedSeats.has(s.seat))
  if (!spend) return "prime plan has no matching pulse escalate probe"
  const seat = keys.seats[spend.seat]
  if (!seat || !keys.pools[seat.poolName]) return `${spend.seat}: missing seat or pool keys`
  const pool = persona.pools.find((p) => p.name === seat.poolName)
  if (!pool) return `${spend.seat}: pool spec missing`
  const minOutcomes = Number(pool.policy.cost_per_outcome_min_outcomes)
  const autoApproveUnderUsd = Number(pool.policy.auto_approve_under_usd)
  const windowDays = Number(pool.policy.cost_per_outcome_window_days) || 30
  const kind = persona.prime.outcomes[0]?.kind
  if (!Number.isInteger(minOutcomes) || minOutcomes < 1) return `${spend.seat}: missing cost_per_outcome_min_outcomes`
  if (!Number.isFinite(autoApproveUnderUsd) || autoApproveUnderUsd <= 0) return `${spend.seat}: missing auto_approve_under_usd`
  if (!kind) return "prime plan has no outcomes"
  return { seat: spend.seat, amountUsd: spend.amount_usd, kind, minOutcomes, autoApproveUnderUsd, windowDays }
}

async function readWindow(
  walletId: string,
  mgmtKey: string,
  kind: string,
  windowDays: number,
): Promise<CpoSummary | string> {
  try {
    const query = new URLSearchParams({ wallet_id: walletId, kind, window_days: String(windowDays) })
    const { status, json } = await call<unknown>(`/outcomes?${query}`, { method: "GET", auth: { mgmt: mgmtKey } })
    if (status !== 200) return `CPO summary HTTP ${status}`
    return parseCpoSummary(json, walletId)
  } catch {
    return "CPO summary request failed"
  }
}

function spendSpec(template: SpendSpec, amountUsd: number, description: string): SpendSpec {
  return { ...template, amount_usd: amountUsd, description, expect: "approved" }
}

/**
 * Ensure the persona's CPO probe will escalate. No-ops when already armed or
 * when the persona has no prime plan. Demo-org scoped: uses that pool's keys.
 */
export async function ensureCpoArmed(
  persona: Persona,
  keys: Keys,
  now: () => Date = () => new Date(),
): Promise<string[]> {
  if (!persona.prime) return []
  const probe = resolveProbe(persona, keys)
  if (typeof probe === "string") return [probe]
  const seat = keys.seats[probe.seat]
  const pool = seat ? keys.pools[seat.poolName] : undefined
  if (!seat || !pool) return [`${probe.seat}: missing seat or pool keys`]
  const summary = await readWindow(pool.walletId, pool.mgmtKey, probe.kind, probe.windowDays)
  if (typeof summary === "string") return [`${probe.seat}: ${summary}`]
  if (summary.ceilingUsd == null) return [`${probe.seat}: no cost-per-outcome ceiling configured`]

  const window: CpoWindow = {
    windowSpendUsd: summary.windowSpendUsd,
    windowOutcomes: summary.outcomes,
    minOutcomes: probe.minOutcomes,
    ceilingUsd: summary.ceilingUsd,
  }
  const plan = planCpoArm(window, probe.amountUsd, {
    autoApproveUnderUsd: probe.autoApproveUnderUsd,
    primeSpendAmounts: persona.prime.spends.map((s) => s.amount_usd),
  })
  if (plan.kind === "already_armed") {
    console.log(`  ✓ ${probe.seat} CPO window already armed ($${summary.windowSpendUsd} / ${summary.outcomes} vs $${summary.ceilingUsd} ceiling)`)
    return []
  }
  if (plan.kind === "impossible") return [`${probe.seat}: ${plan.reason}`]

  const at = now()
  const day = at.toISOString().slice(0, 10)
  const errors: string[] = []

  if (plan.spendAmounts.length) {
    const template = persona.prime.spends[0]
    if (!template) return [`${probe.seat}: prime plan has no spends`]
    console.log("arming CPO window (approved spend):")
    for (const [i, amount] of plan.spendAmounts.entries()) {
      const source = persona.prime.spends[i] ?? template
      const description = source.amount_usd === amount ? (source.description ?? "Search defense — window arm") : "Search defense — window arm"
      const spec = spendSpec(source, amount, description)
      const { json } = await call<{ status?: string; error?: string }>("/authorize", {
        auth: { agent: seat.apiKey },
        body: {
          action: spec.action,
          amount_usd: spec.amount_usd,
          merchant: spec.merchant,
          category: spec.category,
          description: spec.description,
          tags: spec.tags,
        },
      })
      const ok = json.status === "approved"
      console.log(`  ${ok ? "✓" : "✗"} ${spec.seat} ${spec.merchant} $${spec.amount_usd} → ${json.status ?? json.error}`)
      if (!ok) errors.push(`${spec.seat} arming spend $${spec.amount_usd} → ${json.status ?? json.error ?? "error"} (expected approved)`)
    }
  }

  if (plan.outcomeCount > 0) {
    console.log("arming CPO window (backdated outcomes):")
    const templates = [...persona.prime.outcomes].sort((a, b) => a.days_ago - b.days_ago).slice(0, plan.outcomeCount)
    for (const o of templates) {
      const dedupe = `${o.dedupe_key}-${day}`
      const occurredAt = new Date(at.getTime() - o.days_ago * 24 * 3600 * 1000).toISOString()
      const { status, json } = await call<{ error?: string }>("/outcomes", {
        auth: { agent: seat.apiKey },
        body: { kind: o.kind, value_usd: o.value_usd, play: o.play, dedupe_key: dedupe, occurred_at: occurredAt },
      })
      const ok = !json.error && (status === 200 || status === 201)
      console.log(`  ${ok ? "✓" : "✗"} ${o.seat} outcome ${o.kind} (${dedupe}) → ${ok ? "ok" : `${status} ${json.error}`}`)
      if (!ok) errors.push(`${o.seat} arming outcome ${dedupe} → ${status} ${json.error ?? ""}`.trim())
    }
  }

  if (errors.length) return errors

  const again = await readWindow(pool.walletId, pool.mgmtKey, probe.kind, probe.windowDays)
  if (typeof again === "string") return [`${probe.seat}: ${again}`]
  if (again.ceilingUsd == null) return [`${probe.seat}: ceiling disappeared after arming`]
  const armed = wouldCpoEscalate(
    {
      windowSpendUsd: again.windowSpendUsd,
      windowOutcomes: again.outcomes,
      minOutcomes: probe.minOutcomes,
      ceilingUsd: again.ceilingUsd,
    },
    probe.amountUsd,
  )
  if (!armed) {
    return [
      `${probe.seat}: CPO window still would not escalate a $${probe.amountUsd} charge (spend $${again.windowSpendUsd}, ${again.outcomes} outcomes, ceiling $${again.ceilingUsd})`,
    ]
  }
  console.log(`  ✓ ${probe.seat} CPO window armed ($${again.windowSpendUsd} / ${again.outcomes} vs $${again.ceilingUsd} ceiling)`)
  return []
}
