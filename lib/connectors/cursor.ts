// Cursor connector: pulls per-request usage events from the Cursor Admin API
// and maps them into the normalized fact grain.
//
// Contract read from cursor.com/docs/account/teams/admin-api.md and
// cursor.com/docs/api.md on 2026-11-23:
//   POST https://api.cursor.com/teams/filtered-usage-events
//   Basic auth, API key as the username, empty password.
//   startDate / endDate: epoch milliseconds, BOTH bounds inclusive.
//   page is 1-indexed; pageSize defaults to 100, maximum 1000.
//   "Data is aggregated at the hourly level. We recommend polling this
//   endpoint at most once per hour." 60 requests per minute per team.
//   429 carries Retry-After: 60. 403 "Enterprise access required" when the
//   plan lacks the API. A repeating 503 means "use a shorter date range".
//   `chargedCents` is the field that reconciles to /teams/spend.
//
// Usage metadata only. This connector never requests or stores prompt or
// completion content, and the Admin API does not return any.

import { z } from "zod"
import { ConnectorError, DAY_MS, HOUR_MS, hourStart, type FactInput } from "./facts"
import { toNanos } from "./money"
import { createRateLimiter, defaultClock, type FetchDeps } from "./pace"

export const CURSOR_API = "https://api.cursor.com"
export const CURSOR_USAGE_EVENTS_PATH = "/teams/filtered-usage-events"

const PAGE_SIZE = 1000
// One request covers at most a day, so a heavy day is a few pages and a 503 on
// a long range ("use a shorter date range") cannot happen by construction.
const CHUNK_MS = DAY_MS
// Hard stop for one pull: 200 pages is 200,000 events. Past that, fail loudly
// instead of looping for the whole function timeout.
const MAX_CALLS = 200

const count = z.number().int().nonnegative()

// Only the fields this connector reads are validated; anything Cursor adds
// later passes through untouched. A field we DO read changing type fails the
// pull (and the contract test in CI) instead of corrupting stored numbers.
const usageEvent = z.looseObject({
  timestamp: z.string().regex(/^\d{10,16}$/),
  userEmail: z.string().min(1).max(320),
  serviceAccountId: z.string().max(200).optional(),
  cloudAgentId: z.string().max(200).optional(),
  automationId: z.string().max(200).optional(),
  conversationId: z.string().max(200).optional(),
  model: z.string().min(1).max(200),
  isChargeable: z.boolean(),
  isHeadless: z.boolean(),
  tokenUsage: z
    .looseObject({
      inputTokens: count,
      outputTokens: count,
      cacheWriteTokens: count,
      cacheReadTokens: count,
    })
    .optional(),
  chargedCents: z.number().finite(),
})
export type CursorUsageEvent = z.infer<typeof usageEvent>

const usageEventsPage = z.looseObject({
  totalUsageEventsCount: count,
  pagination: z.looseObject({ hasNextPage: z.boolean() }),
  usageEvents: z.array(usageEvent).max(PAGE_SIZE),
})

export function parseCursorUsageEventsPage(body: unknown) {
  const parsed = usageEventsPage.safeParse(body)
  if (!parsed.success) {
    // Field paths only: issue messages can echo values, and values here are
    // other people's email addresses.
    const where = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 5).join(", ")
    throw new ConnectorError("unexpected_response", `Cursor returned usage data in a shape Sanction does not recognize (${where}).`)
  }
  return parsed.data
}

export type CursorFetchDeps = FetchDeps

async function postEventsPage(apiKey: string, body: Record<string, number>, deps: Required<CursorFetchDeps>): Promise<unknown> {
  // One wait on a 429, for as long as Cursor asks (capped), then give up: the
  // hourly poll is the real retry loop, not this function.
  for (let attempt = 0; ; attempt++) {
    await deps.take()
    let res: Response
    try {
      res = await deps.fetch(`${CURSOR_API}${CURSOR_USAGE_EVENTS_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ConnectorError("provider_unavailable", "Could not reach Cursor. Sanction will try again on the next hourly pull.")
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        throw new ConnectorError("unexpected_response", "Cursor returned a response that was not JSON.")
      }
    }
    if (res.status === 401) {
      throw new ConnectorError("bad_key", "Cursor rejected this API key. Check that it was copied in full and has not been revoked.")
    }
    if (res.status === 403) {
      throw new ConnectorError(
        "plan_unsupported",
        "Cursor accepted the key but refused the request. Its Admin API is documented for Enterprise teams, and the key needs a scope that can read usage.",
      )
    }
    if (res.status === 429) {
      if (attempt >= 1) throw new ConnectorError("rate_limited", "Cursor is rate limiting this team. Sanction will try again on the next hourly pull.")
      const retryAfter = Number(res.headers.get("retry-after"))
      await deps.sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60, 90) * 1000)
      continue
    }
    throw new ConnectorError("provider_unavailable", `Cursor returned an error (HTTP ${res.status}). Sanction will try again on the next hourly pull.`)
  }
}

/**
 * Every usage event with a timestamp in [startMs, endMs). Returns the events
 * and how many HTTP calls it took (recorded on the sync run).
 */
export async function fetchCursorUsageEvents(
  apiKey: string,
  window: { startMs: number; endMs: number },
  deps: CursorFetchDeps = {},
): Promise<{ events: CursorUsageEvent[]; httpCalls: number }> {
  const resolved: Required<CursorFetchDeps> = {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? defaultClock.sleep,
    take: deps.take ?? createRateLimiter(),
  }
  const events: CursorUsageEvent[] = []
  let httpCalls = 0

  for (let chunkStart = window.startMs; chunkStart < window.endMs; chunkStart += CHUNK_MS) {
    // Cursor's endDate is inclusive, so each chunk ends one millisecond before
    // the next begins. Adjacent chunks then never return the same event twice.
    const chunkEnd = Math.min(chunkStart + CHUNK_MS, window.endMs) - 1
    let expected = 0
    let received = 0
    for (let page = 1; ; page++) {
      if (++httpCalls > MAX_CALLS) {
        throw new ConnectorError("unexpected_response", "Cursor returned more usage events than one pull can read. Contact Sanction support.")
      }
      const body = await postEventsPage(apiKey, { startDate: chunkStart, endDate: chunkEnd, page, pageSize: PAGE_SIZE }, resolved)
      const parsed = parseCursorUsageEventsPage(body)
      if (page === 1) expected = parsed.totalUsageEventsCount
      received += parsed.usageEvents.length
      events.push(...parsed.usageEvents)
      if (!parsed.pagination.hasNextPage || parsed.usageEvents.length === 0) break
    }
    // Pages are numbered, not cursored: if events land while we page, rows
    // shift and one can be skipped or repeated. The total from page one is the
    // check. A mismatch fails this pull; the next one re-reads the window.
    if (received !== expected) {
      throw new ConnectorError("unexpected_response", "Cursor's usage data changed while it was being read. Sanction will read it again on the next hourly pull.")
    }
  }
  return { events, httpCalls }
}

/**
 * Roll events up to one fact per hour, identity, model and attribution.
 *
 * Cost is `chargedCents`, the field Cursor documents as reconciling to its own
 * spend totals. `isChargeable` splits it: chargeable events are "billed",
 * the rest are "included" (usage the plan already covers). Both are kept so
 * finance can separate new charges from quota burn.
 */
export function normalizeCursorEvents(events: CursorUsageEvent[]): FactInput[] {
  const buckets = new Map<string, FactInput>()
  for (const e of events) {
    const bucket = hourStart(Number(e.timestamp))
    const rawIdentity = e.userEmail.trim().toLowerCase()
    const identityType = e.serviceAccountId ? "service_account" : "user"
    const sessionRef = e.conversationId ?? null
    // An automation is the durable thing that keeps firing; a cloud agent run
    // without one is attributed to the run itself.
    const automationRef = e.automationId ?? (e.cloudAgentId ? `cloud-agent:${e.cloudAgentId}` : null)
    const background = e.isHeadless || automationRef !== null
    const costBasis = e.isChargeable ? "billed" : "included"
    const key = JSON.stringify([bucket, rawIdentity, identityType, e.model, sessionRef, automationRef, e.isHeadless, costBasis])

    const fact = buckets.get(key) ?? {
      provider: "cursor",
      surface: background ? "agent" : "ide",
      rawIdentity,
      identityType,
      model: e.model,
      sessionRef,
      automationRef,
      headless: e.isHeadless,
      bucketStart: new Date(bucket),
      bucketEnd: new Date(bucket + HOUR_MS),
      inputTokens: BigInt(0),
      outputTokens: BigInt(0),
      cacheReadTokens: BigInt(0),
      cacheWriteTokens: BigInt(0),
      requests: 0,
      costNanos: BigInt(0),
      costBasis,
    } satisfies FactInput
    fact.requests += 1
    fact.costNanos += toNanos(e.chargedCents, "cents")
    if (e.tokenUsage) {
      fact.inputTokens += BigInt(e.tokenUsage.inputTokens)
      fact.outputTokens += BigInt(e.tokenUsage.outputTokens)
      fact.cacheReadTokens += BigInt(e.tokenUsage.cacheReadTokens)
      fact.cacheWriteTokens += BigInt(e.tokenUsage.cacheWriteTokens)
    }
    buckets.set(key, fact)
  }
  return [...buckets.values()]
}
