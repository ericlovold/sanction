// OpenAI (API organization) connector: pulls hourly token usage and daily
// cost from OpenAI's organization usage endpoints and maps them into the
// normalized fact grain.
//
// Contract read from developers.openai.com (admin usage reference for
// completions and costs, and the Usage API cookbook) on 2026-11-23:
//   GET https://api.openai.com/v1/organization/usage/completions
//   GET https://api.openai.com/v1/organization/costs
//   Authorization: Bearer <Admin key>
//   start_time inclusive, end_time exclusive, both Unix SECONDS.
//   Usage: bucket_width 1m | 1h | 1d; with 1h, limit is at most 168 buckets
//   a page. group_by any of project_id, user_id, api_key_id, model, ...
//   Costs: bucket_width 1d ONLY; limit 1 to 180 buckets a page. group_by
//   project_id, user_id, line_item, api_key_id, api_source. No model.
//   Pagination is a cursor: has_more + next_page, passed back as `page`.
//   amount.value is a JSON number in the lowercase currency amount.currency.
//
// The two endpoints do not share a grain: money is per day with no model,
// tokens are per hour with a model. normalizeOpenAiBuckets() reconciles them
// and says which numbers are billed and which are derived.
//
// Not pulled yet: the other usage endpoints (embeddings, images, audio, ...).
// Their COST is included, because the costs endpoint covers everything; it
// lands on the person's hours, or on a day-long "(other usage)" row.
//
// Usage metadata only. Nothing here requests prompt or completion content.

import { z } from "zod"
import { ConnectorError, DAY_MS, HOUR_MS, type FactInput } from "./facts"
import { allocate, toNanos } from "./money"
import { createRateLimiter, defaultClock, type FetchDeps } from "./pace"

export const OPENAI_API = "https://api.openai.com"
export const OPENAI_USAGE_PATH = "/v1/organization/usage/completions"
export const OPENAI_COSTS_PATH = "/v1/organization/costs"

const USAGE_PAGE_BUCKETS = 168
const COSTS_PAGE_BUCKETS = 180
const MAX_CALLS = 200

const count = z.number().int().nonnegative()
const seconds = z.number().int().positive()
const id = z.string().max(300).nullish()

const usageResult = z.looseObject({
  input_tokens: count,
  output_tokens: count,
  num_model_requests: count,
  input_cached_tokens: count.optional(),
  input_cache_write_tokens: count.optional(),
  input_uncached_tokens: count.optional(),
  user_id: id,
  api_key_id: id,
  model: z.string().max(200).nullish(),
})
const costResult = z.looseObject({
  amount: z.looseObject({ value: z.number().finite(), currency: z.string().max(10) }).optional(),
  user_id: id,
  api_key_id: id,
})
const page = <T extends z.ZodType>(result: T) =>
  z.looseObject({
    data: z.array(z.looseObject({ start_time: seconds, end_time: seconds, results: z.array(result) })),
    has_more: z.boolean(),
    next_page: z.string().max(4000).nullable(),
  })
const usagePage = page(usageResult)
const costsPage = page(costResult)

export type OpenAiUsageBucket = z.infer<typeof usagePage>["data"][number]
export type OpenAiCostBucket = z.infer<typeof costsPage>["data"][number]

function parse<T extends z.ZodType>(schema: T, body: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const where = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 5).join(", ")
    throw new ConnectorError("unexpected_response", `OpenAI returned ${what} data in a shape Sanction does not recognize (${where}).`)
  }
  return parsed.data
}
export const parseOpenAiUsagePage = (body: unknown) => parse(usagePage, body, "usage")
export const parseOpenAiCostsPage = (body: unknown) => parse(costsPage, body, "cost")

async function getPage(apiKey: string, path: string, query: URLSearchParams, deps: Required<FetchDeps>): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await deps.take()
    let res: Response
    try {
      res = await deps.fetch(`${OPENAI_API}${path}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ConnectorError("provider_unavailable", "Could not reach OpenAI. Sanction will try again on the next hourly pull.")
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        throw new ConnectorError("unexpected_response", "OpenAI returned a response that was not JSON.")
      }
    }
    if (res.status === 401) {
      throw new ConnectorError("bad_key", "OpenAI rejected this key. It must be an Admin key from the organization settings, copied in full and not revoked.")
    }
    if (res.status === 403) {
      throw new ConnectorError("plan_unsupported", "OpenAI accepted the key but refused the usage report. A regular API key cannot read organization usage; an Admin key is required.")
    }
    if (res.status === 400) {
      // Documented for costs: some group_by combinations are refused
      // depending on the organization and time range.
      throw new ConnectorError("unexpected_response", "OpenAI refused the way Sanction asked for this organization's usage. Contact Sanction support.")
    }
    if (res.status === 429) {
      if (attempt >= 1) throw new ConnectorError("rate_limited", "OpenAI is rate limiting this organization. Sanction will try again on the next hourly pull.")
      const retryAfter = Number(res.headers.get("retry-after"))
      await deps.sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60, 90) * 1000)
      continue
    }
    throw new ConnectorError("provider_unavailable", `OpenAI returned an error (HTTP ${res.status}). Sanction will try again on the next hourly pull.`)
  }
}

export type OpenAiPull = { usage: OpenAiUsageBucket[]; costs: OpenAiCostBucket[]; httpCalls: number }

/**
 * Hourly usage and daily costs for [startMs, endMs). `startMs` must be a UTC
 * midnight: money arrives per day, so a pull always covers whole days.
 */
export async function fetchOpenAiUsageAndCosts(
  apiKey: string,
  window: { startMs: number; endMs: number },
  deps: FetchDeps = {},
): Promise<OpenAiPull> {
  const out: OpenAiPull = { usage: [], costs: [], httpCalls: 0 }
  const take = deps.take ?? createRateLimiter()
  const resolved: Required<FetchDeps> = {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? defaultClock.sleep,
    async take() {
      if (out.httpCalls >= MAX_CALLS) {
        throw new ConnectorError("unexpected_response", "OpenAI returned more usage than one pull can read. Contact Sanction support.")
      }
      await take()
      out.httpCalls++
    },
  }
  if (window.endMs <= window.startMs) return out
  const range = { start_time: String(Math.floor(window.startMs / 1000)), end_time: String(Math.ceil(window.endMs / 1000)) }

  const plans = [
    { path: OPENAI_USAGE_PATH, kind: "usage", width: "1h", limit: USAGE_PAGE_BUCKETS, groupBy: ["user_id", "api_key_id", "model"] },
    { path: OPENAI_COSTS_PATH, kind: "costs", width: "1d", limit: COSTS_PAGE_BUCKETS, groupBy: ["user_id", "api_key_id", "line_item"] },
  ] as const
  for (const plan of plans) {
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ ...range, bucket_width: plan.width, limit: String(plan.limit) })
      for (const dimension of plan.groupBy) query.append("group_by", dimension)
      if (cursor) query.set("page", cursor)
      const body = await getPage(apiKey, plan.path, query, resolved)
      const parsed = plan.kind === "usage" ? parseOpenAiUsagePage(body) : parseOpenAiCostsPage(body)
      if (plan.kind === "usage") out.usage.push(...(parsed.data as OpenAiUsageBucket[]))
      else out.costs.push(...(parsed.data as OpenAiCostBucket[]))
      cursor = parsed.has_more ? parsed.next_page : null
      if (parsed.has_more && !cursor) throw new ConnectorError("unexpected_response", "OpenAI said there was more data but gave no way to fetch it.")
    } while (cursor)
  }
  return out
}

const ZERO = BigInt(0)

type Identity = Pick<FactInput, "rawIdentity" | "identityType">
function identityOf(r: { user_id?: string | null; api_key_id?: string | null }): Identity {
  if (r.user_id) return { rawIdentity: r.user_id, identityType: "user" }
  if (r.api_key_id) return { rawIdentity: r.api_key_id, identityType: "api_key" }
  return { rawIdentity: "unattributed", identityType: "unattributed" }
}

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

/**
 * Reconcile hourly tokens with daily money.
 *
 * For each identity and UTC day:
 *   - Day is priced and the identity has hourly usage: the day's cost is
 *     spread over those hours in proportion to tokens. The day total and the
 *     per-person total are exactly what OpenAI billed. The hourly shares
 *     have an "allocated" basis because the provider reports no hourly cost.
 *   - Day is priced but the identity has no completions usage (embeddings,
 *     images, ...): a day-long "(other usage)" row carries the charges.
 *     Credits always have their own day-long row.
 *   - Day is not priced yet (the costs endpoint returned nothing at all for
 *     it, typically today): hours are "estimated" at the identity's own
 *     recent cost per token, else the organization's, else zero.
 *   - Day is priced for others and this identity has no cost row: zero.
 */
export function normalizeOpenAiBuckets(usage: OpenAiUsageBucket[], costs: OpenAiCostBucket[]): FactInput[] {
  type Row = { fact: FactInput; weight: bigint }
  const rowsByIdentityDay = new Map<string, Row[]>()
  const key = (i: Identity, day: number) => JSON.stringify([i.rawIdentity, i.identityType, day])
  const merged = new Map<string, Row>()

  for (const bucket of usage) {
    const start = bucket.start_time * 1000
    for (const r of bucket.results) {
      const identity = identityOf(r)
      const model = r.model ?? "(no model)"
      const cached = r.input_cached_tokens ?? 0
      const written = r.input_cache_write_tokens ?? 0
      // input_tokens includes cached and cache-write tokens.
      const uncached = r.input_uncached_tokens ?? Math.max(0, r.input_tokens - cached - written)
      const rowKey = JSON.stringify([start, identity.rawIdentity, identity.identityType, model])
      let row = merged.get(rowKey)
      if (!row) {
        row = {
          weight: ZERO,
          fact: {
            provider: "openai", surface: "api", ...identity, model, sessionRef: null, automationRef: null, headless: false,
            bucketStart: new Date(start), bucketEnd: new Date(start + HOUR_MS),
            inputTokens: ZERO, outputTokens: ZERO, cacheReadTokens: ZERO, cacheWriteTokens: ZERO,
            requests: 0, costNanos: ZERO, costBasis: "billed",
          },
        }
        merged.set(rowKey, row)
        const k = key(identity, utcDay(start))
        rowsByIdentityDay.set(k, [...(rowsByIdentityDay.get(k) ?? []), row])
      }
      row.fact.inputTokens += BigInt(uncached)
      row.fact.outputTokens += BigInt(r.output_tokens)
      row.fact.cacheReadTokens += BigInt(cached)
      row.fact.cacheWriteTokens += BigInt(written)
      row.fact.requests += r.num_model_requests
      row.weight += BigInt(r.input_tokens + r.output_tokens)
    }
  }

  const pricedDays = new Set<number>()
  const costByIdentityDay = new Map<string, { identity: Identity; day: number; charges: bigint; credits: bigint }>()
  for (const bucket of costs) {
    const day = utcDay(bucket.start_time * 1000)
    for (const r of bucket.results) {
      if (!r.amount) continue
      if (r.amount.currency.toLowerCase() !== "usd") {
        throw new ConnectorError("unexpected_response", "OpenAI reported cost in a currency other than US dollars, which Sanction does not convert.")
      }
      pricedDays.add(day)
      const identity = identityOf(r)
      const k = key(identity, day)
      const entry = costByIdentityDay.get(k) ?? { identity, day, charges: ZERO, credits: ZERO }
      const cost = toNanos(r.amount.value, "usd")
      if (cost < ZERO) entry.credits += cost
      else entry.charges += cost
      costByIdentityDay.set(k, entry)
    }
  }

  const facts: FactInput[] = []
  // What a token has cost recently, from this organization's own bills.
  const rate = new Map<string, { cost: bigint; weight: bigint }>()
  const addRate = (who: string, cost: bigint, weight: bigint) => {
    for (const k of [who, "*"]) {
      const r = rate.get(k) ?? { cost: ZERO, weight: ZERO }
      rate.set(k, { cost: r.cost + cost, weight: r.weight + weight })
    }
  }

  for (const [k, { identity, day, charges, credits }] of costByIdentityDay) {
    const rows = rowsByIdentityDay.get(k) ?? []
    const weight = rows.reduce((s, r) => s + r.weight, ZERO)
    if (weight > ZERO) {
      rows.sort((a, b) => a.fact.bucketStart.getTime() - b.fact.bucketStart.getTime() ||
        (a.fact.model < b.fact.model ? -1 : a.fact.model > b.fact.model ? 1 : 0))
      const parts = allocate(charges, rows.map((r) => r.weight))
      rows.forEach((r, i) => {
        r.fact.costNanos = parts[i]
        r.fact.costBasis = "allocated"
      })
      if (charges > ZERO || credits === ZERO) addRate(JSON.stringify([identity.rawIdentity, identity.identityType]), charges, weight)
    }
    for (const [model, cost] of [["(other usage)", weight > ZERO ? ZERO : charges], ["(credit)", credits]] as const) {
      if (cost === ZERO) continue
      facts.push({
        provider: "openai", surface: "api", ...identity, model, sessionRef: null, automationRef: null, headless: false,
        bucketStart: new Date(day), bucketEnd: new Date(day + DAY_MS),
        inputTokens: ZERO, outputTokens: ZERO, cacheReadTokens: ZERO, cacheWriteTokens: ZERO, requests: 0, costNanos: cost, costBasis: "billed",
      })
    }
  }

  for (const [k, rows] of rowsByIdentityDay) {
    const [rawIdentity, identityType, day] = JSON.parse(k) as [string, string, number]
    if (pricedDays.has(day)) continue // priced: allocated above, or genuinely zero
    const r = rate.get(JSON.stringify([rawIdentity, identityType])) ?? rate.get("*")
    for (const row of rows) {
      row.fact.costBasis = "estimated"
      row.fact.costNanos = r && r.weight > ZERO ? (row.weight * r.cost) / r.weight : ZERO
    }
  }

  for (const row of merged.values()) facts.push(row.fact)
  return facts.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime() || a.rawIdentity.localeCompare(b.rawIdentity) || a.model.localeCompare(b.model))
}
