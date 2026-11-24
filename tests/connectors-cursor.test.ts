// Cursor connector: the contract with the Admin API (against the response
// examples copied from Cursor's docs), the HTTP behavior, and normalization.

import { describe, expect, it, vi } from "vitest"
import docs from "./fixtures/cursor/usage-events.docs.json"
import {
  CURSOR_API, CURSOR_USAGE_EVENTS_PATH, fetchCursorUsageEvents,
  normalizeCursorEvents, parseCursorUsageEventsPage, type CursorUsageEvent,
} from "../lib/connectors/cursor"
import { createRateLimiter } from "../lib/connectors/pace"
import { ConnectorError, factDedupeKey, needsReconnect } from "../lib/connectors/facts"
import { sumNanos, toNanos } from "../lib/connectors/money"

const [mixedPage, serviceAccountPage] = docs.examples
const noWait = { sleep: async () => {}, take: async () => {} }

function page(events: unknown[], hasNextPage = false, total = events.length) {
  return { totalUsageEventsCount: total, pagination: { numPages: 1, currentPage: 1, pageSize: 1000, hasNextPage, hasPreviousPage: false }, usageEvents: events }
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}
function event(over: Record<string, unknown> = {}) {
  return { ...mixedPage.usageEvents[0], ...over }
}

describe("contract: Cursor's documented responses", () => {
  it("parses every documented example", () => {
    for (const example of docs.examples) {
      const parsed = parseCursorUsageEventsPage(example)
      expect(parsed.usageEvents).toHaveLength(example.usageEvents.length)
    }
  })

  it("reads the fields Sanction depends on with the documented types", () => {
    const [first, , included] = parseCursorUsageEventsPage(mixedPage).usageEvents
    expect(first.timestamp).toBe("1750979225854")
    expect(first.userEmail).toBe("developer@company.com")
    expect(first.conversationId).toBe("8f2e4a1b-6c3d-4e5f-9a7b-2d1c8e6f4a3b")
    expect(first.chargedCents).toBe(21.36232)
    expect(first.tokenUsage).toMatchObject({ inputTokens: 126, outputTokens: 450, cacheWriteTokens: 6112, cacheReadTokens: 11964 })
    // A non-token-based event has no tokenUsage at all.
    expect(included.tokenUsage).toBeUndefined()
    expect(included.isChargeable).toBe(false)
    expect(parseCursorUsageEventsPage(serviceAccountPage).usageEvents[0].serviceAccountId).toBe("sa_abc123")
  })

  it("fails loudly when a field Sanction reads changes type or goes missing", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["usageEvents.0.chargedCents", { chargedCents: "21.36" }],
      ["usageEvents.0.timestamp", { timestamp: 1750979225854 }],
      ["usageEvents.0.isHeadless", { isHeadless: undefined }],
      ["usageEvents.0.userEmail", { userEmail: undefined }],
      ["usageEvents.0.tokenUsage.inputTokens", { tokenUsage: { inputTokens: -1, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 } }],
    ]
    for (const [path, change] of cases) {
      const attempt = () => parseCursorUsageEventsPage(page([event(change)]))
      expect(attempt, path).toThrow(ConnectorError)
      expect(attempt).toThrow(path)
    }
    expect(() => parseCursorUsageEventsPage({ usageEvents: [] })).toThrow(/pagination|totalUsageEventsCount/)
  })

  it("names the field in the error, never a value from the payload", () => {
    try {
      parseCursorUsageEventsPage(page([event({ chargedCents: "secret-looking-value", userEmail: "someone@private.example" })]))
      throw new Error("expected a ConnectorError")
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError)
      expect((error as Error).message).not.toMatch(/secret-looking-value|private\.example/)
    }
  })

  it("ignores fields Cursor adds later", () => {
    expect(parseCursorUsageEventsPage(page([event({ somethingNew: { nested: true } })])).usageEvents).toHaveLength(1)
  })
})

describe("fetchCursorUsageEvents", () => {
  const start = Date.UTC(2026, 10, 20)
  const DAY = 86_400_000

  it("sends Basic auth with the key as username, one inclusive day per request", async () => {
    const fetchMock = vi.fn(async () => json(page([])))
    const result = await fetchCursorUsageEvents("crsr_testkey", { startMs: start, endMs: start + 2 * DAY + 3_600_000 }, { fetch: fetchMock as never, ...noWait })
    expect(result.httpCalls).toBe(3)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${CURSOR_API}${CURSOR_USAGE_EVENTS_PATH}`)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("crsr_testkey:").toString("base64")}`)
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
    // Chunks tile the window with no shared millisecond (Cursor's endDate is inclusive).
    expect(bodies.map((b) => [b.startDate, b.endDate])).toEqual([
      [start, start + DAY - 1],
      [start + DAY, start + 2 * DAY - 1],
      [start + 2 * DAY, start + 2 * DAY + 3_600_000 - 1],
    ])
    expect(bodies.every((b) => b.page === 1 && b.pageSize === 1000)).toBe(true)
  })

  it("follows pagination and returns every event", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(page([event(), event()], true, 3)))
      .mockResolvedValueOnce(json(page([event()], false, 3)))
    const result = await fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: fetchMock as never, ...noWait })
    expect(result.events).toHaveLength(3)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).page).toBe(2)
  })

  it("fails the pull when the data shifted between pages, instead of storing a partial hour", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(page([event(), event()], true, 4)))
      .mockResolvedValueOnce(json(page([event()], false, 4)))
    await expect(fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: fetchMock as never, ...noWait }))
      .rejects.toMatchObject({ kind: "unexpected_response" })
  })

  it("maps provider failures to something the connect screen can act on", async () => {
    const cases: [Response | Error, string][] = [
      [json({ error: "Unauthorized", message: "Invalid API key" }, 401), "bad_key"],
      [json({ error: "Forbidden", message: "Enterprise access required" }, 403), "plan_unsupported"],
      [json({ error: "x" }, 503), "provider_unavailable"],
      [new TypeError("fetch failed"), "provider_unavailable"],
      [new Response("<html>", { status: 200 }), "unexpected_response"],
    ]
    for (const [outcome, kind] of cases) {
      const fetchMock = vi.fn(async () => {
        if (outcome instanceof Error) throw outcome
        return outcome
      })
      await expect(fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: fetchMock as never, ...noWait }))
        .rejects.toMatchObject({ kind })
    }
  })

  it("never puts the API key in an error message", async () => {
    const fetchMock = vi.fn(async () => json({ message: "Invalid API key crsr_supersecret" }, 401))
    const error = await fetchCursorUsageEvents("crsr_supersecret", { startMs: start, endMs: start + DAY }, { fetch: fetchMock as never, ...noWait }).catch((e) => e)
    expect(String(error.message)).not.toContain("crsr_supersecret")
  })

  it("honors Retry-After once on a 429, then gives up until the next poll", async () => {
    const sleep = vi.fn(async () => {})
    const recovered = vi.fn()
      .mockResolvedValueOnce(json({ code: "error", message: "Rate limit exceeded" }, 429, { "retry-after": "60" }))
      .mockResolvedValueOnce(json(page([event()])))
    const ok = await fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: recovered as never, sleep, take: async () => {} })
    expect(ok.events).toHaveLength(1)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(60_000)

    const stuck = vi.fn(async () => json({}, 429))
    await expect(fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: stuck as never, sleep, take: async () => {} }))
      .rejects.toMatchObject({ kind: "rate_limited" })
    expect(stuck).toHaveBeenCalledTimes(2)
    // A missing or absurd Retry-After falls back to a bounded wait.
    expect(sleep).toHaveBeenLastCalledWith(60_000)
  })

  it("stops instead of looping forever when a provider never ends pagination", async () => {
    const fetchMock = vi.fn(async () => json(page([event()], true, 999_999)))
    await expect(fetchCursorUsageEvents("k", { startMs: start, endMs: start + DAY }, { fetch: fetchMock as never, ...noWait }))
      .rejects.toMatchObject({ kind: "unexpected_response" })
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(200)
  })
})

describe("createRateLimiter stays inside 60 requests a minute", () => {
  it("lets a burst through, then paces", async () => {
    let now = 0
    const sleeps: number[] = []
    const take = createRateLimiter({}, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms } })
    for (let i = 0; i < 30; i++) await take()
    expect(sleeps).toEqual([])
    await take()
    expect(sleeps).toEqual([2000])
    // 90 more calls: never more than 60 inside any rolling minute.
    const times: number[] = []
    for (let i = 0; i < 90; i++) { await take(); times.push(now) }
    for (const t of times) expect(times.filter((x) => x > t - 60_000 && x <= t).length).toBeLessThanOrEqual(60)
  })

  it("refills while idle, up to capacity", async () => {
    let now = 0
    const sleeps: number[] = []
    const take = createRateLimiter({ capacity: 2, refillMs: 1000 }, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms } })
    await take(); await take()
    now += 10_000
    await take(); await take()
    expect(sleeps).toEqual([])
    await take()
    expect(sleeps).toHaveLength(1)
  })
})

describe("normalizeCursorEvents", () => {
  const events = parseCursorUsageEventsPage(mixedPage).usageEvents

  it("rolls events up to the hour, per identity, model, conversation and cost basis", () => {
    const facts = normalizeCursorEvents(events)
    // Two billed events share an hour, user, model and conversation; the third is plan-included.
    expect(facts).toHaveLength(2)
    const billed = facts.find((f) => f.costBasis === "billed")!
    expect(billed).toMatchObject({
      provider: "cursor", surface: "ide", rawIdentity: "developer@company.com", identityType: "user",
      model: "claude-4.5-sonnet", sessionRef: "8f2e4a1b-6c3d-4e5f-9a7b-2d1c8e6f4a3b", automationRef: null, headless: false, requests: 2,
    })
    expect(billed.bucketStart.toISOString()).toBe("2025-06-26T23:00:00.000Z")
    expect(billed.bucketEnd.getTime() - billed.bucketStart.getTime()).toBe(3_600_000)
    expect(billed.inputTokens).toBe(BigInt(126 + 5805))
    expect(billed.cacheReadTokens).toBe(BigInt(11964))
    // chargedCents, the field Cursor reconciles to its own spend totals.
    expect(billed.costNanos).toBe(toNanos("21.36232", "cents") + toNanos("37.33", "cents"))
    const included = facts.find((f) => f.costBasis === "included")!
    expect(included.costNanos).toBe(toNanos("8", "cents"))
    expect(included.inputTokens).toBe(BigInt(0))
  })

  it("conserves money: the facts sum to exactly the events' chargedCents", () => {
    const facts = normalizeCursorEvents(events)
    expect(sumNanos(facts.map((f) => f.costNanos))).toBe(sumNanos(events.map((e) => toNanos(e.chargedCents, "cents"))))
  })

  it("attributes background work: service accounts, automations, cloud agents", () => {
    const [sa] = normalizeCursorEvents(parseCursorUsageEventsPage(serviceAccountPage).usageEvents)
    expect(sa).toMatchObject({ identityType: "service_account", rawIdentity: "agent-runner@company.com", headless: true, surface: "agent" })
    const base = events[0]
    const [auto] = normalizeCursorEvents([{ ...base, automationId: "7fc64f90", cloudAgentId: "bc-1" }])
    expect(auto).toMatchObject({ automationRef: "7fc64f90", surface: "agent" })
    const [cloud] = normalizeCursorEvents([{ ...base, cloudAgentId: "bc-1" }])
    expect(cloud.automationRef).toBe("cloud-agent:bc-1")
  })

  it("folds email case and whitespace into one identity", () => {
    const base = events[0]
    const facts = normalizeCursorEvents([base, { ...base, userEmail: "  Developer@Company.com " }])
    expect(facts).toHaveLength(1)
    expect(facts[0].requests).toBe(2)
  })

  it("is idempotent: the same events, in any order, give the same facts and keys", () => {
    const shuffled = [...events].reverse() as CursorUsageEvent[]
    const key = (list: CursorUsageEvent[]) =>
      normalizeCursorEvents(list).map((f) => `${factDedupeKey("conn_1", f)}:${f.costNanos}:${f.requests}`).sort()
    expect(key(shuffled)).toEqual(key(events))
    expect(new Set(key(events)).size).toBe(2)
    // A different connection never shares a key.
    const [fact] = normalizeCursorEvents(events)
    expect(factDedupeKey("conn_2", fact)).not.toBe(factDedupeKey("conn_1", fact))
  })
})

describe("needsReconnect", () => {
  it("stops polling only for failures a retry cannot fix", () => {
    expect(["bad_key", "plan_unsupported", "missing_credential"].every(needsReconnect)).toBe(true)
    expect(["rate_limited", "provider_unavailable", "unexpected_response", null, undefined].some(needsReconnect)).toBe(false)
  })
})
