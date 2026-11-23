// Runaway guardrails: pure rules over normalized facts, plus the incident
// replay the connector epic sets as its acceptance test.

import { describe, expect, it } from "vitest"
import { normalizeCursorEvents, parseCursorUsageEventsPage } from "../lib/connectors/cursor"
import type { FactInput } from "../lib/connectors/facts"
import { DEFAULT_THRESHOLDS, evaluateGuardrails, p95, type GuardFact } from "../lib/connectors/guardrails"
import { toNanos, usd } from "../lib/connectors/money"
import { INCIDENT_CONVERSATION, INCIDENT_HOURS, INCIDENT_START, INCIDENT_USER, baselineEvents, incidentEvents } from "./helpers/cursor-incident"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 10, 10)

function guardFacts(facts: FactInput[]): GuardFact[] {
  return facts.map((f) => ({
    provider: f.provider, rawIdentity: f.rawIdentity, model: f.model, sessionRef: f.sessionRef, automationRef: f.automationRef,
    headless: f.headless, bucketStartMs: f.bucketStart.getTime(), costNanos: f.costNanos, billed: f.costBasis === "billed",
  }))
}
function fact(over: Partial<GuardFact> & { hour: number; dollars: string }): GuardFact {
  const { hour, dollars, ...rest } = over
  return {
    provider: "cursor", rawIdentity: "a@example.test", model: "m", sessionRef: null, automationRef: null, headless: false,
    bucketStartMs: T0 + hour * HOUR, costNanos: toNanos(dollars, "usd"), billed: true, ...rest,
  }
}
// Through the real path: documented event shape, contract parse, normalize.
// Pages of 1,000, Cursor's maximum, which the contract enforces.
function through(events: unknown[]): GuardFact[] {
  const parsed = []
  for (let i = 0; i < events.length; i += 1000) {
    const page = { totalUsageEventsCount: events.length, pagination: { hasNextPage: i + 1000 < events.length }, usageEvents: events.slice(i, i + 1000) }
    parsed.push(...parseCursorUsageEventsPage(page).usageEvents)
  }
  return guardFacts(normalizeCursorEvents(parsed))
}

describe("replay: the Cursor scanner incident (synthetic, see tests/helpers/cursor-incident.ts)", () => {
  it("the fixture matches the incident's published totals: about $140 and 1.1 billion tokens", () => {
    const facts = normalizeCursorEvents(parseCursorUsageEventsPage({
      totalUsageEventsCount: 0, pagination: { hasNextPage: false }, usageEvents: incidentEvents(),
    }).usageEvents)
    expect(facts).toHaveLength(INCIDENT_HOURS)
    expect(facts.reduce((s, f) => s + f.costNanos, BigInt(0))).toBe(usd(140))
    const tokens = facts.reduce((s, f) => s + f.inputTokens + f.outputTokens + f.cacheReadTokens + f.cacheWriteTokens, BigInt(0))
    expect(Number(tokens)).toBeGreaterThan(1.09e9)
    expect(Number(tokens)).toBeLessThan(1.11e9)
  })

  it("fires on the FIRST poll after the spike is visible in Cursor's data", () => {
    // One hour of the runaway is all the provider has reported so far.
    const alerts = evaluateGuardrails(through([...baselineEvents(), ...incidentEvents(1)]), INCIDENT_START - 48 * HOUR)
    const runaway = alerts.find((a) => a.rule === "runaway_rate")
    expect(runaway).toBeDefined()
    expect(runaway).toMatchObject({ provider: "cursor", subjectType: "conversation", subjectKey: INCIDENT_CONVERSATION })
    expect(runaway!.windowStart.getTime()).toBe(INCIDENT_START)
    expect(runaway!.observedNanos).toBe(usd(20))
    // Baseline: 40 events x 4.5 cents = $1.80 in a normal busy hour, so the line is 5 x $1.80 = $9.
    expect(runaway!.evidence.baselineP95Nanos).toBe(toNanos("1.8", "usd").toString())
    expect(runaway!.thresholdNanos).toBe(usd(9))
    expect(runaway!.evidence).toMatchObject({ identity: INCIDENT_USER, billedNanos: usd(20).toString(), baselineHours: 56 })
    expect(runaway!.evidence.top[0]).toMatchObject({ sessionRef: INCIDENT_CONVERSATION, costNanos: usd(20).toString() })
  })

  it("also trips the headless-burn rule in that same first hour ($20 of background spend against $10)", () => {
    const alerts = evaluateGuardrails(through([...baselineEvents(), ...incidentEvents(1)]), INCIDENT_START - 48 * HOUR)
    expect(alerts.find((a) => a.rule === "headless_burn")).toMatchObject({
      subjectType: "conversation", subjectKey: INCIDENT_CONVERSATION, observedNanos: usd(20), thresholdNanos: usd(10),
    })
    // $20 is under the $50 daily line; that one comes later.
    expect(alerts.find((a) => a.rule === "daily_cap")).toBeUndefined()
  })

  it("the whole seven-hour burn is one alert per rule, not one per hour", () => {
    const alerts = evaluateGuardrails(through([...baselineEvents(), ...incidentEvents()]), INCIDENT_START - 48 * HOUR)
    expect(alerts.map((a) => a.rule).sort()).toEqual(["daily_cap", "headless_burn", "runaway_rate"])
    expect(alerts.find((a) => a.rule === "daily_cap")).toMatchObject({ subjectType: "person", subjectKey: INCIDENT_USER, observedNanos: usd(140) })
  })

  it("polling again does not change the alert identity (the sync dedupes on it)", () => {
    const early = evaluateGuardrails(through([...baselineEvents(), ...incidentEvents(1)]), INCIDENT_START - 48 * HOUR)
    const later = evaluateGuardrails(through([...baselineEvents(), ...incidentEvents(5)]), INCIDENT_START - 46 * HOUR)
    for (const a of early) expect(later.map((l) => l.dedupeKey)).toContain(a.dedupeKey)
  })

  it("a normal week raises nothing", () => {
    expect(evaluateGuardrails(through(baselineEvents()), INCIDENT_START - 8 * DAY)).toEqual([])
  })
})

describe("runaway_rate", () => {
  const week = Array.from({ length: 20 }, (_, i) => fact({ hour: i * 6, dollars: "2" }))

  it("needs both: above the multiple of baseline AND above the floor", () => {
    const at = (dollars: string) => evaluateGuardrails([...week, fact({ hour: 150, dollars })], T0 + 150 * HOUR).filter((a) => a.rule === "runaway_rate")
    expect(at("10")).toHaveLength(0) // exactly 5 x $2 is not over the line
    expect(at("10.01")).toHaveLength(1)
    // A tiny baseline: 5 x 10 cents is 50 cents, but the $5 floor still applies.
    const quiet = Array.from({ length: 20 }, (_, i) => fact({ hour: i * 6, dollars: "0.1" }))
    const quietAt = (dollars: string) => evaluateGuardrails([...quiet, fact({ hour: 150, dollars })], T0 + 150 * HOUR).filter((a) => a.rule === "runaway_rate")
    expect(quietAt("4")).toHaveLength(0)
    expect(quietAt("5.5")[0].thresholdNanos).toBe(usd(5))
  })

  it("with no history, only the floor decides", () => {
    const alerts = evaluateGuardrails([fact({ hour: 0, dollars: "6" })], T0)
    expect(alerts.find((a) => a.rule === "runaway_rate")).toMatchObject({ subjectType: "person", thresholdNanos: usd(5) })
    expect(alerts[0].evidence).toMatchObject({ baselineP95Nanos: "0", baselineHours: 0 })
  })

  it("ignores history older than the baseline window", () => {
    // A $50 hour nine days ago must not make a $12 hour look normal.
    const facts = [fact({ hour: 0, dollars: "50" }), fact({ hour: 9 * 24, dollars: "12" })]
    expect(evaluateGuardrails(facts, T0 + 9 * DAY).filter((a) => a.rule === "runaway_rate")).toHaveLength(1)
  })

  it("names the automation when one automation is over the line alone, else the conversation, else the person", () => {
    const spike = (over: (Partial<GuardFact> & { dollars?: string })[]) =>
      evaluateGuardrails(over.map((o) => fact({ hour: 0, dollars: "4", ...o })), T0).find((a) => a.rule === "runaway_rate")!
    expect(spike([{ automationRef: "auto-1", sessionRef: "c1", dollars: "9" }])).toMatchObject({ subjectType: "automation", subjectKey: "auto-1" })
    expect(spike([{ sessionRef: "c1", dollars: "9" }, { sessionRef: "c2", dollars: "1" }])).toMatchObject({ subjectType: "conversation", subjectKey: "c1", observedNanos: usd(9) })
    // Three conversations at $4 each: no single one is over $5, the person is.
    expect(spike([{ sessionRef: "c1" }, { sessionRef: "c2" }, { sessionRef: "c3" }])).toMatchObject({ subjectType: "person", subjectKey: "a@example.test", observedNanos: usd(12) })
  })

  it("keeps people and providers apart", () => {
    const facts = [fact({ hour: 0, dollars: "3" }), fact({ hour: 0, dollars: "3", rawIdentity: "b@example.test" }), fact({ hour: 0, dollars: "3", provider: "openai" })]
    expect(evaluateGuardrails(facts, T0)).toEqual([])
  })

  it("does not alert on hours before the evaluated range", () => {
    expect(evaluateGuardrails([fact({ hour: 0, dollars: "30" })], T0 + HOUR).filter((a) => a.rule === "runaway_rate")).toEqual([])
  })
})

describe("headless_burn", () => {
  it("sums two consecutive hours of background work", () => {
    const facts = [fact({ hour: 0, dollars: "4", headless: true, automationRef: "nightly" }), fact({ hour: 1, dollars: "4", headless: true, automationRef: "nightly" })]
    expect(evaluateGuardrails(facts, T0).filter((a) => a.rule === "headless_burn")).toEqual([])
    facts.push(fact({ hour: 1, dollars: "2.5", headless: true, automationRef: "nightly", model: "other" }))
    const [alert] = evaluateGuardrails(facts, T0).filter((a) => a.rule === "headless_burn")
    expect(alert).toMatchObject({ subjectType: "automation", subjectKey: "nightly", observedNanos: toNanos("10.5", "usd") })
    expect(alert.windowEnd.getTime() - alert.windowStart.getTime()).toBe(2 * HOUR)
  })

  it("does not count interactive work, and does not join hours that are not adjacent", () => {
    expect(evaluateGuardrails([fact({ hour: 0, dollars: "4.9" }), fact({ hour: 1, dollars: "4.9" }), fact({ hour: 2, dollars: "4.9" })], T0).filter((a) => a.rule === "headless_burn")).toEqual([])
    const apart = [fact({ hour: 0, dollars: "4.9", headless: true }), fact({ hour: 5, dollars: "4.9", headless: true })]
    expect(evaluateGuardrails(apart, T0).filter((a) => a.rule === "headless_burn")).toEqual([])
  })

  it("falls back to the identity when background work carries no automation or conversation", () => {
    const [alert] = evaluateGuardrails([fact({ hour: 0, dollars: "4.9", headless: true }), fact({ hour: 1, dollars: "4.9", headless: true }), fact({ hour: 1, dollars: "0.3", headless: true, model: "x" })], T0)
      .filter((a) => a.rule === "headless_burn")
    expect(alert).toMatchObject({ subjectType: "person", subjectKey: "a@example.test" })
  })
})

describe("daily_cap", () => {
  it("fires past $50 in a UTC day, counting billed and included usage, and reports the billed part", () => {
    const facts = Array.from({ length: 12 }, (_, i) => fact({ hour: i * 2, dollars: "4", billed: i % 2 === 0 }))
    expect(evaluateGuardrails(facts, T0).filter((a) => a.rule === "daily_cap")).toEqual([])
    facts.push(fact({ hour: 23, dollars: "2.01" }))
    const [alert] = evaluateGuardrails(facts, T0).filter((a) => a.rule === "daily_cap")
    expect(alert.observedNanos).toBe(toNanos("50.01", "usd"))
    expect(alert.evidence.billedNanos).toBe(toNanos("26.01", "usd").toString())
    expect(alert.evidence.top).toHaveLength(5)
  })

  it("does not carry spend across midnight UTC", () => {
    const facts = [fact({ hour: 23, dollars: "4.5" }), fact({ hour: 23, dollars: "4.5", model: "b" }), ...Array.from({ length: 10 }, (_, i) => fact({ hour: 24 + i, dollars: "4.5" }))]
    expect(evaluateGuardrails(facts, T0).filter((a) => a.rule === "daily_cap")).toEqual([])
  })

  it("skips days entirely before the evaluated range", () => {
    expect(evaluateGuardrails([fact({ hour: 0, dollars: "4.9" }), ...Array.from({ length: 12 }, (_, i) => fact({ hour: i, dollars: "4.9", model: `m${i}` }))], T0 + DAY)).toEqual([])
  })
})

describe("determinism and thresholds", () => {
  it("same facts, any order, same alerts", () => {
    const facts = through([...baselineEvents(), ...incidentEvents()])
    const a = evaluateGuardrails(facts, INCIDENT_START - DAY)
    const b = evaluateGuardrails([...facts].reverse(), INCIDENT_START - DAY)
    expect(b.map((x) => [x.dedupeKey, x.observedNanos])).toEqual(a.map((x) => [x.dedupeKey, x.observedNanos]))
  })

  it("thresholds are parameters, not constants", () => {
    const strict = { ...DEFAULT_THRESHOLDS, dailyCapNanos: usd(1), runawayFloorNanos: usd(100), headlessBurnNanos: usd(100) }
    expect(evaluateGuardrails([fact({ hour: 0, dollars: "2" })], T0, strict).map((a) => a.rule)).toEqual(["daily_cap"])
  })

  it("p95 is nearest-rank", () => {
    expect(p95([])).toBe(BigInt(0))
    expect(p95([BigInt(7)])).toBe(BigInt(7))
    expect(p95(Array.from({ length: 100 }, (_, i) => BigInt(i + 1)))).toBe(BigInt(95))
    expect(p95([BigInt(3), BigInt(1), BigInt(2)])).toBe(BigInt(3))
  })
})
