// Runaway guardrails over normalized usage facts.
//
// Pure, like the policy rules in lib/rules: facts and thresholds in, alerts
// out. No IO and no clock, so the same facts always produce the same alerts
// and a past incident can be replayed in a test. The sync shell
// (lib/connectors/sync.ts) reads the facts, calls this, and persists.
//
// These rules observe. They run on data the provider reports after the fact
// (hourly for Cursor), so the earliest they can fire is the first pull after
// the spend shows up in the provider's own numbers.

import { createHash } from "node:crypto"
import { DAY_MS, HOUR_MS } from "./facts"
import { usd } from "./money"

export type GuardFact = {
  provider: string
  rawIdentity: string
  model: string
  sessionRef: string | null
  automationRef: string | null
  headless: boolean
  bucketStartMs: number // hour-aligned UTC
  costNanos: bigint
  billed: boolean
}

export type GuardThresholds = {
  // runaway_rate: an hour above BOTH multiple x baseline AND the floor.
  runawayMultiple: number
  runawayFloorNanos: bigint
  baselineDays: number
  // headless_burn: background work above this in any two consecutive hours.
  headlessBurnNanos: bigint
  // daily_cap: one identity above this in a UTC day.
  dailyCapNanos: bigint
}

// Starting points from the epic, to be tuned on real data.
export const DEFAULT_THRESHOLDS: GuardThresholds = {
  runawayMultiple: 5,
  runawayFloorNanos: usd(5),
  baselineDays: 7,
  headlessBurnNanos: usd(10),
  dailyCapNanos: usd(50),
}

export type AlertRule = "runaway_rate" | "headless_burn" | "daily_cap"
export type AlertSubject = "person" | "automation" | "conversation"

export type AlertEvidence = {
  identity: string
  billedNanos: string // of observedNanos, the part the provider charged
  baselineP95Nanos?: string
  baselineHours?: number
  // Largest contributors to the window, biggest first.
  top: { hour: string; model: string; sessionRef: string | null; automationRef: string | null; costNanos: string }[]
}

export type AlertInput = {
  rule: AlertRule
  provider: string
  subjectType: AlertSubject
  subjectKey: string
  windowStart: Date
  windowEnd: Date
  observedNanos: bigint
  thresholdNanos: bigint
  evidence: AlertEvidence
  dedupeKey: string
}

const ZERO = BigInt(0)

function add(map: Map<string, bigint>, key: string, value: bigint) {
  map.set(key, (map.get(key) ?? ZERO) + value)
}

function total(facts: GuardFact[]): bigint {
  let sum = ZERO
  for (const f of facts) sum += f.costNanos
  return sum
}

/** Nearest-rank 95th percentile. Empty input is zero. */
export function p95(values: bigint[]): bigint {
  if (!values.length) return ZERO
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return sorted[Math.ceil(0.95 * sorted.length) - 1]
}

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

// One alert per rule, subject and UTC day: a job that burns for nine hours is
// one alert, and it alerts again if it is still burning after midnight.
function dedupeKey(rule: AlertRule, provider: string, subjectType: string, subjectKey: string, windowStartMs: number): string {
  return createHash("sha256").update(JSON.stringify([rule, provider, subjectType, subjectKey, utcDay(windowStartMs)])).digest("hex")
}

function evidence(identity: string, facts: GuardFact[], extra: Partial<AlertEvidence> = {}): AlertEvidence {
  const top = [...facts]
    .sort((a, b) => (a.costNanos < b.costNanos ? 1 : a.costNanos > b.costNanos ? -1 : a.bucketStartMs - b.bucketStartMs))
    .slice(0, 5)
    .map((f) => ({
      hour: new Date(f.bucketStartMs).toISOString(),
      model: f.model,
      sessionRef: f.sessionRef,
      automationRef: f.automationRef,
      costNanos: f.costNanos.toString(),
    }))
  return { identity, billedNanos: total(facts.filter((f) => f.billed)).toString(), ...extra, top }
}

// The most specific thing to name. If one automation or one conversation is
// over the line by itself, the alert names it; otherwise it names the person.
// One alert per person-hour either way, never three for the same spike.
function narrowSubject(facts: GuardFact[], threshold: bigint): { subjectType: AlertSubject; subjectKey: string; facts: GuardFact[] } | null {
  for (const [subjectType, ref] of [["automation", "automationRef"], ["conversation", "sessionRef"]] as const) {
    const byRef = new Map<string, bigint>()
    for (const f of facts) if (f[ref]) add(byRef, f[ref], f.costNanos)
    const [key, cost] = [...byRef.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))[0] ?? []
    if (key && cost !== undefined && cost > threshold) {
      return { subjectType, subjectKey: key, facts: facts.filter((f) => f[ref] === key) }
    }
  }
  return null
}

/**
 * Evaluate every rule over `facts`, raising alerts only for windows that
 * start at or after `evaluateFromMs`. `facts` must reach back `baselineDays`
 * before that point, or baselines are computed from less history than asked.
 */
export function evaluateGuardrails(
  facts: GuardFact[],
  evaluateFromMs: number,
  thresholds: GuardThresholds = DEFAULT_THRESHOLDS,
): AlertInput[] {
  const alerts = new Map<string, AlertInput>()
  const raise = (a: Omit<AlertInput, "dedupeKey">) => {
    const key = dedupeKey(a.rule, a.provider, a.subjectType, a.subjectKey, a.windowStart.getTime())
    // First window of the day wins; later hours of the same burn are the same alert.
    if (!alerts.has(key)) alerts.set(key, { ...a, dedupeKey: key })
  }

  const byPerson = new Map<string, GuardFact[]>()
  for (const f of facts) {
    const key = JSON.stringify([f.provider, f.rawIdentity])
    byPerson.set(key, [...(byPerson.get(key) ?? []), f])
  }

  for (const personFacts of byPerson.values()) {
    const { provider, rawIdentity } = personFacts[0]
    const hourly = new Map<number, GuardFact[]>()
    for (const f of personFacts) hourly.set(f.bucketStartMs, [...(hourly.get(f.bucketStartMs) ?? []), f])
    const hours = [...hourly.keys()].sort((a, b) => a - b)
    const hourCost = new Map(hours.map((h) => [h, total(hourly.get(h)!)]))

    // runaway_rate: this hour against the person's own recent busy hours.
    // The baseline is the p95 of hours with any spend in the trailing window,
    // so idle time does not drag a normal working hour toward "anomalous".
    // With no history the multiple contributes nothing and the floor decides.
    for (const h of hours) {
      if (h < evaluateFromMs) continue
      const baselineHours = hours.filter((b) => b < h && b >= h - thresholds.baselineDays * DAY_MS)
      const baseline = p95(baselineHours.map((b) => hourCost.get(b)!).filter((c) => c > ZERO))
      const scaled = baseline * BigInt(Math.round(thresholds.runawayMultiple * 100)) / BigInt(100)
      const threshold = scaled > thresholds.runawayFloorNanos ? scaled : thresholds.runawayFloorNanos
      const observed = hourCost.get(h)!
      if (observed <= threshold) continue
      const hourFacts = hourly.get(h)!
      const narrowed = narrowSubject(hourFacts, threshold)
      const subjectFacts = narrowed?.facts ?? hourFacts
      raise({
        rule: "runaway_rate",
        provider,
        subjectType: narrowed?.subjectType ?? "person",
        subjectKey: narrowed?.subjectKey ?? rawIdentity,
        windowStart: new Date(h),
        windowEnd: new Date(h + HOUR_MS),
        observedNanos: total(subjectFacts),
        thresholdNanos: threshold,
        evidence: evidence(rawIdentity, subjectFacts, { baselineP95Nanos: baseline.toString(), baselineHours: baselineHours.length }),
      })
    }

    // headless_burn: background work with nobody at the keyboard, summed over
    // two consecutive hours. Grouped by the automation, else the conversation,
    // else the identity running it.
    const headless = new Map<string, { subjectType: AlertSubject; subjectKey: string; facts: GuardFact[] }>()
    for (const f of personFacts) {
      if (!f.headless) continue
      const subjectType: AlertSubject = f.automationRef ? "automation" : f.sessionRef ? "conversation" : "person"
      const subjectKey = f.automationRef ?? f.sessionRef ?? rawIdentity
      const group = headless.get(subjectKey) ?? { subjectType, subjectKey, facts: [] }
      group.facts.push(f)
      headless.set(subjectKey, group)
    }
    for (const group of headless.values()) {
      const groupHours = [...new Set(group.facts.map((f) => f.bucketStartMs))].sort((a, b) => a - b)
      for (const h of groupHours) {
        if (h < evaluateFromMs) continue
        const windowFacts = group.facts.filter((f) => f.bucketStartMs === h || f.bucketStartMs === h - HOUR_MS)
        const observed = total(windowFacts)
        if (observed <= thresholds.headlessBurnNanos) continue
        raise({
          rule: "headless_burn",
          provider,
          subjectType: group.subjectType,
          subjectKey: group.subjectKey,
          windowStart: new Date(h - HOUR_MS),
          windowEnd: new Date(h + HOUR_MS),
          observedNanos: observed,
          thresholdNanos: thresholds.headlessBurnNanos,
          evidence: evidence(rawIdentity, windowFacts),
        })
      }
    }

    // daily_cap: one identity's total for a UTC day.
    const daily = new Map<number, GuardFact[]>()
    for (const f of personFacts) {
      const day = utcDay(f.bucketStartMs)
      daily.set(day, [...(daily.get(day) ?? []), f])
    }
    for (const [day, dayFacts] of daily) {
      // A day is evaluated when any of it falls in the evaluated range.
      if (day + DAY_MS <= evaluateFromMs) continue
      const observed = total(dayFacts)
      if (observed <= thresholds.dailyCapNanos) continue
      raise({
        rule: "daily_cap",
        provider,
        subjectType: "person",
        subjectKey: rawIdentity,
        windowStart: new Date(day),
        windowEnd: new Date(day + DAY_MS),
        observedNanos: observed,
        thresholdNanos: thresholds.dailyCapNanos,
        evidence: evidence(rawIdentity, dayFacts),
      })
    }
  }

  return [...alerts.values()].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime() || a.dedupeKey.localeCompare(b.dedupeKey))
}
