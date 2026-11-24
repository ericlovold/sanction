// Claude (Console organization) connector: pulls hourly usage and cost from
// Anthropic's Usage and Cost Analytics API and maps them into the normalized
// fact grain.
//
// Contract read from platform.claude.com/docs/en/manage-claude/
// usage-cost-analytics-api and the API reference for both endpoints on
// 2026-11-23:
//   GET https://api.anthropic.com/v1/organizations/analytics/usage
//   GET https://api.anthropic.com/v1/organizations/analytics/cost
//   Headers: x-api-key (Admin API key), anthropic-version,
//            anthropic-beta: analytics-usage-cost-2026-08-24  (beta API)
//   starting_at inclusive, ending_at exclusive, both rounded DOWN to the
//   bucket. A request spans at most 31 days. limit is 1 to 1000 rows a page.
//   Pagination is a cursor: has_more + next_page, passed back as `page`.
//   A cursor can expire when the data refreshes (HTTP 410).
//   Every response carries data_refreshed_at; usage after it is missing or
//   partial. Data typically refreshes within 4 hours, up to 24, and values
//   can be revised until about 7 days after the end of the calendar month.
//   cost.amount is a decimal STRING in cents with six decimals, after
//   discounts and before credits ("41280.000000" is $412.80).
//   Not available to claude.ai Team plan orgs or individual Console accounts.
//
// Usage metadata only: tokens, cost, model, product and who. Nothing here
// requests prompt or completion content.

import { z } from "zod"
import { ConnectorError, DAY_MS, type FactInput } from "./facts"
import { toNanos } from "./money"
import { createRateLimiter, defaultClock, type FetchDeps } from "./pace"

export const ANTHROPIC_API = "https://api.anthropic.com"
export const ANTHROPIC_USAGE_PATH = "/v1/organizations/analytics/usage"
export const ANTHROPIC_COST_PATH = "/v1/organizations/analytics/cost"
export const ANTHROPIC_VERSION = "2026-10-21"
export const ANTHROPIC_BETA = "analytics-usage-cost-2026-08-24"

const PAGE_SIZE = 1000
const MAX_CALLS = 200
// Three of the five allowed dimensions: who, which model, which product.
const GROUP_BY = ["actor", "model", "product"]

const count = z.number().int().nonnegative()
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)

// The identity a row is attributed to. Only `type` and the one id each kind
// carries are read; an unknown future kind is kept as "unattributed" rather
// than failing the pull, because it does not change any number.
const actor = z
  .looseObject({
    type: z.string().max(100),
    user_id: z.string().max(200).optional(),
    email_address: z.string().max(320).nullish(),
    service_account_id: z.string().max(200).optional(),
    api_key_id: z.string().max(200).optional(),
    provider: z.looseObject({ type: z.string().max(50) }).optional(),
    subject: z.string().max(2000).nullish(),
  })
  .nullable()

const group = z.looseObject({
  actor,
  model: z.string().max(200).nullable(),
  product: z.string().max(100).nullable(),
})

const usageRow = z.looseObject({
  starting_at: instant,
  ending_at: instant,
  group,
  usage: z.looseObject({
    uncached_input_tokens: count,
    output_tokens: count,
    cache_read_input_tokens: count,
    cache_creation: z.looseObject({ ephemeral_1h_input_tokens: count, ephemeral_5m_input_tokens: count }),
    requests: count.nullable(),
  }),
})
const costRow = z.looseObject({
  starting_at: instant,
  ending_at: instant,
  group,
  cost: z.looseObject({
    // A decimal string, never a JSON number: parsed digit by digit.
    amount: z.string().regex(/^-?\d+(\.\d+)?$/).max(40),
    currency: z.literal("USD"),
  }),
})
const envelope = <T extends z.ZodType>(row: T) =>
  z.looseObject({
    data: z.array(row),
    data_refreshed_at: instant.nullable(),
    has_more: z.boolean(),
    next_page: z.string().max(4000).nullable(),
  })
const usagePage = envelope(usageRow)
const costPage = envelope(costRow)

export type AnthropicUsageRow = z.infer<typeof usageRow>
export type AnthropicCostRow = z.infer<typeof costRow>

function parse<T extends z.ZodType>(schema: T, body: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Field paths only: values here include other people's email addresses.
    const where = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 5).join(", ")
    throw new ConnectorError("unexpected_response", `Claude returned ${what} data in a shape Sanction does not recognize (${where}).`)
  }
  return parsed.data
}
export const parseAnthropicUsagePage = (body: unknown) => parse(usagePage, body, "usage")
export const parseAnthropicCostPage = (body: unknown) => parse(costPage, body, "cost")

async function getPage(apiKey: string, path: string, query: URLSearchParams, deps: Required<FetchDeps>): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await deps.take()
    let res: Response
    try {
      res = await deps.fetch(`${ANTHROPIC_API}${path}?${query.toString()}`, {
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "anthropic-beta": ANTHROPIC_BETA },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ConnectorError("provider_unavailable", "Could not reach Claude. Sanction will try again on the next hourly pull.")
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        throw new ConnectorError("unexpected_response", "Claude returned a response that was not JSON.")
      }
    }
    if (res.status === 401) {
      throw new ConnectorError("bad_key", "Claude rejected this key. It must be an Admin API key from a Claude Console organization, copied in full and not revoked.")
    }
    if (res.status === 403) {
      throw new ConnectorError(
        "plan_unsupported",
        "Claude accepted the key but refused the usage report. The Admin API is not available to claude.ai Team plan organizations or to individual Console accounts.",
      )
    }
    if (res.status === 410) {
      throw new ConnectorError("unexpected_response", "Claude's usage data refreshed while it was being read. Sanction will read it again on the next hourly pull.")
    }
    if (res.status === 429) {
      if (attempt >= 1) throw new ConnectorError("rate_limited", "Claude is rate limiting this organization. Sanction will try again on the next hourly pull.")
      const retryAfter = Number(res.headers.get("retry-after"))
      await deps.sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60, 90) * 1000)
      continue
    }
    throw new ConnectorError("provider_unavailable", `Claude returned an error (HTTP ${res.status}). Sanction will try again on the next hourly pull.`)
  }
}

export type AnthropicPull = {
  usage: AnthropicUsageRow[]
  cost: AnthropicCostRow[]
  // The earlier of the two endpoints' data_refreshed_at; null when Anthropic
  // has no data yet for any part of the window.
  refreshedAt: Date | null
  httpCalls: number
}

/**
 * Hourly usage and cost for [startMs, endMs), both hour-aligned. Each request
 * covers at most 31 days, including when catching up after a missed pull.
 */
export async function fetchAnthropicUsageAndCost(
  apiKey: string,
  window: { startMs: number; endMs: number },
  deps: FetchDeps = {},
): Promise<AnthropicPull> {
  const resolved: Required<FetchDeps> = {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? defaultClock.sleep,
    take: deps.take ?? createRateLimiter(),
  }
  const out: AnthropicPull = { usage: [], cost: [], refreshedAt: null, httpCalls: 0 }
  // Anthropic rounds both ends down to the hour; an empty window is a no-op,
  // not a request for "the default 31 days".
  if (window.endMs <= window.startMs) return out

  const refreshed: (string | null)[] = []
  const maxWindow = 31 * DAY_MS
  for (let start = window.startMs; start < window.endMs; start += maxWindow) {
    const end = Math.min(start + maxWindow, window.endMs)
    for (const [path, kind] of [[ANTHROPIC_USAGE_PATH, "usage"], [ANTHROPIC_COST_PATH, "cost"]] as const) {
      let cursor: string | null = null
      do {
        if (++out.httpCalls > MAX_CALLS) {
          throw new ConnectorError("unexpected_response", "Claude returned more usage rows than one pull can read. Contact Sanction support.")
        }
        const query = new URLSearchParams({
          starting_at: new Date(start).toISOString(),
          ending_at: new Date(end).toISOString(),
          time_bucket_width: "1h",
          order_by: "time",
          limit: String(PAGE_SIZE),
        })
        for (const dimension of GROUP_BY) query.append("group_by[]", dimension)
        if (cursor) query.set("page", cursor)
        const body = await getPage(apiKey, path, query, resolved)
        const page = kind === "usage" ? parseAnthropicUsagePage(body) : parseAnthropicCostPage(body)
        if (kind === "usage") out.usage.push(...(page.data as AnthropicUsageRow[]))
        else out.cost.push(...(page.data as AnthropicCostRow[]))
        if (cursor === null) refreshed.push(page.data_refreshed_at)
        cursor = page.has_more ? page.next_page : null
        if (page.has_more && !cursor) throw new ConnectorError("unexpected_response", "Claude said there was more data but gave no way to fetch it.")
      } while (cursor)
    }
  }
  const known = refreshed.filter((r): r is string => r !== null).map((r) => Date.parse(r))
  out.refreshedAt = known.length === refreshed.length && known.length ? new Date(Math.min(...known)) : null
  return out
}

type Identity = Pick<FactInput, "rawIdentity" | "identityType">

function identityOf(a: z.infer<typeof actor>): Identity {
  if (!a) return { rawIdentity: "unattributed", identityType: "unattributed" }
  switch (a.type) {
    case "user_actor":
      // Email when Anthropic has one (it is the cross-tool join key); the
      // tagged user id for a deleted account.
      return { rawIdentity: a.email_address?.trim().toLowerCase() || a.user_id || "unattributed", identityType: "user" }
    case "service_account_actor":
      return { rawIdentity: a.service_account_id ?? "unattributed", identityType: "service_account" }
    case "api_actor":
      return { rawIdentity: a.api_key_id ?? "unattributed", identityType: "api_key" }
    case "federated_actor":
      return { rawIdentity: `federated:${a.provider?.type ?? "unknown"}:${a.subject ?? "unknown"}`.slice(0, 300), identityType: "service_account" }
    default:
      return { rawIdentity: "unattributed", identityType: "unattributed" }
  }
}

function surfaceOf(product: string | null): FactInput["surface"] {
  if (product === "claude_code") return "claude_code"
  if (product === "managed_agents_api") return "agent"
  if (product === null || product.endsWith("_api") || product === "claude_console") return "api"
  return "chat"
}

/**
 * Join usage rows (tokens) and cost rows (money) on hour, identity, model and
 * persisted surface. A combination present on only one side is kept: cost with no
 * tokens is real (web search, session time), and so is the reverse (Priority
 * Tier requests are covered by a commitment and cost zero here).
 */
export function normalizeAnthropicRows(usage: AnthropicUsageRow[], cost: AnthropicCostRow[]): FactInput[] {
  const facts = new Map<string, FactInput>()
  const factFor = (row: { starting_at: string; ending_at: string; group: z.infer<typeof group> }): FactInput => {
    const identity = identityOf(row.group.actor)
    const model = row.group.model ?? "(no model)"
    const start = Date.parse(row.starting_at)
    const end = Date.parse(row.ending_at)
    const surface = surfaceOf(row.group.product)
    const key = JSON.stringify([start, end, identity.rawIdentity, identity.identityType, model, surface])
    let fact = facts.get(key)
    if (!fact) {
      fact = {
        provider: "anthropic",
        surface,
        ...identity,
        model,
        sessionRef: null,
        automationRef: null,
        // Anthropic does not say whether a client was attached. Automations
        // are still caught by the rate rule against their own baseline.
        headless: false,
        bucketStart: new Date(start),
        bucketEnd: new Date(end),
        inputTokens: BigInt(0),
        outputTokens: BigInt(0),
        cacheReadTokens: BigInt(0),
        cacheWriteTokens: BigInt(0),
        requests: 0,
        costNanos: BigInt(0),
        // amount is after discounts and before credits: what was charged.
        costBasis: "billed",
      }
      facts.set(key, fact)
    }
    return fact
  }
  for (const row of usage) {
    const fact = factFor(row)
    fact.inputTokens += BigInt(row.usage.uncached_input_tokens)
    fact.outputTokens += BigInt(row.usage.output_tokens)
    fact.cacheReadTokens += BigInt(row.usage.cache_read_input_tokens)
    fact.cacheWriteTokens += BigInt(row.usage.cache_creation.ephemeral_1h_input_tokens + row.usage.cache_creation.ephemeral_5m_input_tokens)
    fact.requests += row.usage.requests ?? 0
  }
  for (const row of cost) factFor(row).costNanos += toNanos(row.cost.amount, "cents")
  return [...facts.values()]
}
