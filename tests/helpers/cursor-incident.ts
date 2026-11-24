// SYNTHETIC replay fixture, shaped like the 2026-11 Cursor scanner incident
// described in the connector epic: a headless vulnerability scanner that hit a
// bug and ran without stopping, about 1.1 billion tokens and about $140.
//
// This is NOT the real export. It is generated from those two published
// totals, in the exact event shape Cursor documents, so the whole path
// (contract parse, normalize, guardrails) is exercised. Replace it with the
// scrubbed real events from /teams/filtered-usage-events when they are
// available; the assertions in the replay test should still hold.

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const INCIDENT_USER = "dev@example.test"
export const INCIDENT_CONVERSATION = "c0ffee00-0000-4000-8000-5ca44e400001"
// The scanner starts at 02:00 UTC on a Tuesday and runs seven hours.
export const INCIDENT_START = Date.UTC(2026, 10, 17, 2)
export const INCIDENT_HOURS = 7
// 100 events an hour at 20 cents each is $20 an hour, $140 over the run.
const EVENTS_PER_HOUR = 100
const CENTS_PER_EVENT = 20

type Event = Record<string, unknown>

function event(ms: number, over: Partial<Event> = {}): Event {
  return {
    timestamp: String(ms),
    userEmail: INCIDENT_USER,
    conversationId: "11111111-1111-4111-8111-111111111111",
    model: "claude-4.5-sonnet",
    kind: "Usage-based",
    maxMode: false,
    requestsCosts: 1,
    isTokenBasedCall: true,
    isChargeable: true,
    isHeadless: false,
    tokenUsage: { inputTokens: 4000, outputTokens: 600, cacheWriteTokens: 0, cacheReadTokens: 20000, totalCents: 4.2 },
    chargedCents: 4.5,
    product: "cursor",
    ...over,
  }
}

/** Seven ordinary working days before the incident: about $1.80 an hour, eight hours a day. */
export function baselineEvents(): Event[] {
  const out: Event[] = []
  for (let day = 7; day >= 1; day--) {
    const dayStart = INCIDENT_START - 2 * HOUR - day * DAY
    for (let hour = 14; hour < 22; hour++) {
      for (let i = 0; i < 40; i++) {
        out.push(event(dayStart + hour * HOUR + i * 60_000, { conversationId: `aaaaaaaa-0000-4000-8000-${String(day).padStart(4, "0")}${String(hour).padStart(8, "0")}` }))
      }
    }
  }
  return out
}

/** The runaway, optionally cut off after `hours` (what one early poll would have seen). */
export function incidentEvents(hours = INCIDENT_HOURS): Event[] {
  const out: Event[] = []
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < EVENTS_PER_HOUR; i++) {
      out.push(
        event(INCIDENT_START + h * HOUR + i * 30_000, {
          conversationId: INCIDENT_CONVERSATION,
          isHeadless: true,
          maxMode: true,
          // 1,571,428 tokens an event x 700 events is about 1.1 billion.
          tokenUsage: { inputTokens: 71_428, outputTokens: 20_000, cacheWriteTokens: 80_000, cacheReadTokens: 1_400_000, totalCents: 19 },
          chargedCents: CENTS_PER_EVENT,
        }),
      )
    }
  }
  return out
}
