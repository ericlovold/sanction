// Claude connector: the contract with Anthropic's Usage and Cost Analytics
// API (against the response examples copied from its API reference), the HTTP
// behavior, and normalization.

import { describe, expect, it, vi } from "vitest"
import docs from "./fixtures/anthropic/usage-cost.docs.json"
import {
  ANTHROPIC_API, ANTHROPIC_BETA, ANTHROPIC_COST_PATH, ANTHROPIC_USAGE_PATH, ANTHROPIC_VERSION,
  fetchAnthropicUsageAndCost, normalizeAnthropicRows, parseAnthropicCostPage, parseAnthropicUsagePage,
  type AnthropicCostRow, type AnthropicUsageRow,
} from "../lib/connectors/anthropic"
import { adapterFor } from "../lib/connectors/adapters"
import { ConnectorError, factDedupeKey } from "../lib/connectors/facts"
import { sumNanos, toNanos } from "../lib/connectors/money"

const HOUR = 3_600_000
const noWait = { sleep: async () => {}, take: async () => {} }
const start = Date.UTC(2026, 10, 20)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const page = (data: unknown[], more: string | null = null, refreshed: string | null = "2026-11-23T04:00:00Z") => ({
  data, data_refreshed_at: refreshed, has_more: more !== null, next_page: more,
})

type Group = { actor?: unknown; model?: string | null; product?: string | null }
const group = (g: Group = {}) => ({
  actor: "actor" in g ? g.actor : { type: "user_actor", user_id: "user_01", email_address: "Dev@Example.test", name: "Dev", deleted: false },
  model: "model" in g ? g.model : "claude-opus-5-5",
  product: "product" in g ? g.product : "claude_code",
})
const usageRow = (hour: number, g: Group = {}, usage: Record<string, unknown> = {}) => ({
  starting_at: new Date(start + hour * HOUR).toISOString(), ending_at: new Date(start + (hour + 1) * HOUR).toISOString(), group: group(g),
  usage: { uncached_input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 70 }, requests: 4, total_tokens: 6300, ...usage },
})
const costRow = (hour: number, amount: string, g: Group = {}) => ({
  starting_at: new Date(start + hour * HOUR).toISOString(), ending_at: new Date(start + (hour + 1) * HOUR).toISOString(), group: group(g),
  cost: { amount, list_amount: amount, currency: "USD", requests: 4 },
})

// Serves usage then cost, honoring the cursor.
function serving(usagePages: unknown[], costPages: unknown[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(url)
    const pages = u.pathname === ANTHROPIC_USAGE_PATH ? usagePages : costPages
    const cursor = u.searchParams.get("page")
    return json(pages[cursor ? Number(cursor) : 0])
  })
}

describe("contract: Anthropic's documented responses", () => {
  it("parses the documented usage and cost examples", () => {
    const usage = parseAnthropicUsagePage(docs.usage)
    expect(usage.data).toHaveLength(1)
    expect(usage.data[0].group.actor).toMatchObject({ type: "user_actor", email_address: "user@emaildomain.com" })
    expect(usage.data[0].usage).toMatchObject({ uncached_input_tokens: 1284500, output_tokens: 891000, cache_read_input_tokens: 3200000, requests: 128 })
    expect(usage.data_refreshed_at).toBe("2026-10-01T04:02:11Z")
    const cost = parseAnthropicCostPage(docs.cost)
    // A decimal string in cents with six decimals: $412.80.
    expect(cost.data[0].cost.amount).toBe("41280.000000")
    expect(toNanos(cost.data[0].cost.amount, "cents")).toBe(toNanos("412.8", "usd"))
  })

  it("normalizes the documented examples into one fact", () => {
    const [fact] = normalizeAnthropicRows(parseAnthropicUsagePage(docs.usage).data, parseAnthropicCostPage(docs.cost).data)
    expect(fact).toMatchObject({
      provider: "anthropic", surface: "chat", rawIdentity: "user@emaildomain.com", identityType: "user", model: "claude-opus-5-5",
      requests: 128, costBasis: "billed", headless: false, sessionRef: null,
    })
    expect(fact.costNanos).toBe(toNanos("412.8", "usd"))
    expect(fact.inputTokens).toBe(BigInt(1284500))
  })

  it("fails loudly when a field Sanction reads changes type or goes missing", () => {
    const usageCases: [string, unknown][] = [
      ["data.0.usage.output_tokens", usageRow(0, {}, { output_tokens: "200" })],
      ["data.0.usage.cache_creation", usageRow(0, {}, { cache_creation: undefined })],
      ["data.0.starting_at", { ...usageRow(0), starting_at: 1700000000 }],
      ["data.0.group.model", { ...usageRow(0), group: { actor: null, product: null } }],
    ]
    for (const [path, row] of usageCases) {
      const attempt = () => parseAnthropicUsagePage(page([row]))
      expect(attempt, path).toThrow(ConnectorError)
      expect(attempt).toThrow(path)
    }
    // Money must stay a decimal string: a float or another currency is refused.
    for (const cost of [{ amount: 41280.5, currency: "USD" }, { amount: "41280.000000", currency: "EUR" }, { amount: "1e5", currency: "USD" }]) {
      expect(() => parseAnthropicCostPage(page([{ ...costRow(0, "1"), cost }]))).toThrow(ConnectorError)
    }
    expect(() => parseAnthropicUsagePage({ data: [] })).toThrow(/data_refreshed_at|has_more/)
  })

  it("names the field in the error, never a value from the payload", () => {
    const row = usageRow(0, { actor: { type: "user_actor", user_id: "u", email_address: "someone@private.example" } }, { output_tokens: "secret-value" })
    const error = (() => { try { parseAnthropicUsagePage(page([row])) } catch (e) { return e as Error } })()
    expect(error).toBeInstanceOf(ConnectorError)
    expect(error!.message).not.toMatch(/secret-value|private\.example/)
  })

  it("accepts nulls where the reference allows them, and fields added later", () => {
    const row = { ...usageRow(0, { actor: null, model: null, product: null }, { requests: null }), something_new: 1 }
    expect(parseAnthropicUsagePage(page([row], null, null)).data).toHaveLength(1)
  })
})

describe("fetchAnthropicUsageAndCost", () => {
  it("asks both endpoints for hourly buckets grouped by who, model and product, with the beta headers", async () => {
    const fetchMock = serving([page([usageRow(0)])], [page([costRow(0, "150.000000")])])
    const result = await fetchAnthropicUsageAndCost("admin-key", { startMs: start, endMs: start + 24 * HOUR }, { fetch: fetchMock as never, ...noWait })
    expect(result).toMatchObject({ httpCalls: 2 })
    expect(result.usage).toHaveLength(1)
    expect(result.cost).toHaveLength(1)
    expect(result.refreshedAt?.toISOString()).toBe("2026-11-23T04:00:00.000Z")
    const [usageUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const u = new URL(usageUrl)
    expect(`${u.origin}${u.pathname}`).toBe(`${ANTHROPIC_API}${ANTHROPIC_USAGE_PATH}`)
    expect(new URL(fetchMock.mock.calls[1][0] as string).pathname).toBe(ANTHROPIC_COST_PATH)
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      starting_at: "2026-11-20T00:00:00.000Z", ending_at: "2026-11-21T00:00:00.000Z", time_bucket_width: "1h", order_by: "time", limit: "1000",
    })
    expect(u.searchParams.getAll("group_by[]")).toEqual(["actor", "model", "product"])
    expect(init.headers).toEqual({ "x-api-key": "admin-key", "anthropic-version": ANTHROPIC_VERSION, "anthropic-beta": ANTHROPIC_BETA })
    expect(init.method).toBeUndefined() // GET
  })

  it("follows the cursor on each endpoint", async () => {
    const fetchMock = serving([page([usageRow(0)], "1"), page([usageRow(1)], "2"), page([usageRow(2)])], [page([costRow(0, "1")], "1"), page([costRow(1, "1")])])
    const result = await fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + 24 * HOUR }, { fetch: fetchMock as never, ...noWait })
    expect(result.usage).toHaveLength(3)
    expect(result.cost).toHaveLength(2)
    expect(result.httpCalls).toBe(5)
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("page")).toBe("1")
  })

  it("reports the EARLIER refresh time of the two endpoints, and null when either has no data yet", async () => {
    const mixed = serving([page([usageRow(0)], null, "2026-11-23T04:00:00Z")], [page([costRow(0, "1")], null, "2026-11-23T02:00:00Z")])
    expect((await fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: mixed as never, ...noWait })).refreshedAt?.toISOString()).toBe("2026-11-23T02:00:00.000Z")
    const none = serving([page([])], [page([], null, null)])
    expect(await fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: none as never, ...noWait })).toMatchObject({ refreshedAt: null, usage: [], cost: [] })
  })

  it("makes no request for an empty window (Anthropic would default it to 31 days)", async () => {
    const fetchMock = vi.fn()
    expect(await fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start }, { fetch: fetchMock as never, ...noWait })).toMatchObject({ httpCalls: 0, usage: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps provider failures to something the connect screen can act on", async () => {
    const cases: [Response | Error, string][] = [
      [json({ error: { type: "authentication_error" } }, 401), "bad_key"],
      [json({ error: { type: "permission_error" } }, 403), "plan_unsupported"],
      [json({}, 410), "unexpected_response"],
      [json({}, 500), "provider_unavailable"],
      [new TypeError("fetch failed"), "provider_unavailable"],
      [new Response("<html>", { status: 200 }), "unexpected_response"],
      [json(page([usageRow(0)], null as never)).clone(), "ok"],
    ]
    for (const [outcome, kind] of cases) {
      const fetchMock = vi.fn(async () => {
        if (outcome instanceof Error) throw outcome
        return outcome.clone()
      })
      const attempt = fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: fetchMock as never, ...noWait })
      if (kind === "ok") await expect(attempt).rejects.toMatchObject({ kind: "unexpected_response" }) // usage row served to the cost endpoint
      else await expect(attempt).rejects.toMatchObject({ kind })
    }
  })

  it("never puts the key in an error message", async () => {
    const fetchMock = vi.fn(async () => json({ error: { message: "invalid x-api-key sk-ant-admin-supersecret" } }, 401))
    const error = await fetchAnthropicUsageAndCost("sk-ant-admin-supersecret", { startMs: start, endMs: start + HOUR }, { fetch: fetchMock as never, ...noWait }).catch((e) => e)
    expect(String(error.message)).not.toContain("supersecret")
  })

  it("waits once on a 429, then gives up until the next poll", async () => {
    const sleep = vi.fn(async () => {})
    const recovered = vi.fn()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "12" }))
      .mockResolvedValueOnce(json(page([])))
      .mockResolvedValueOnce(json(page([])))
    await fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: recovered as never, sleep, take: async () => {} })
    expect(sleep).toHaveBeenCalledExactlyOnceWith(12_000)
    const stuck = vi.fn(async () => json({}, 429))
    await expect(fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: stuck as never, sleep, take: async () => {} })).rejects.toMatchObject({ kind: "rate_limited" })
    expect(sleep).toHaveBeenLastCalledWith(60_000)
  })

  it("stops on a cursor that never ends, and on has_more with no cursor", async () => {
    const forever = vi.fn(async () => json(page([usageRow(0)], "0")))
    await expect(fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: forever as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
    expect(forever.mock.calls.length).toBeLessThanOrEqual(200)
    const broken = vi.fn(async () => json({ ...page([]), has_more: true, next_page: null }))
    await expect(fetchAnthropicUsageAndCost("k", { startMs: start, endMs: start + HOUR }, { fetch: broken as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
  })
})

describe("normalizeAnthropicRows", () => {
  const rows = (u: unknown[], c: unknown[]) =>
    normalizeAnthropicRows(parseAnthropicUsagePage(page(u)).data as AnthropicUsageRow[], parseAnthropicCostPage(page(c)).data as AnthropicCostRow[])

  it("joins tokens and money on hour, identity, model and product", () => {
    const facts = rows([usageRow(0), usageRow(1)], [costRow(0, "150.000000"), costRow(1, "25.500000")])
    expect(facts).toHaveLength(2)
    expect(facts[0]).toMatchObject({ rawIdentity: "dev@example.test", identityType: "user", surface: "claude_code", requests: 4 })
    expect(facts[0].bucketStart.toISOString()).toBe("2026-11-20T00:00:00.000Z")
    expect(facts[0].bucketEnd.getTime() - facts[0].bucketStart.getTime()).toBe(HOUR)
    expect(facts[0].inputTokens).toBe(BigInt(1000))
    expect(facts[0].cacheWriteTokens).toBe(BigInt(100)) // 1h + 5m cache writes
    expect(facts[0].cacheReadTokens).toBe(BigInt(5000))
    expect(facts[0].costNanos).toBe(toNanos("1.5", "usd"))
    expect(facts[1].costNanos).toBe(toNanos("0.255", "usd"))
  })

  it("conserves money exactly, down to Anthropic's sixth decimal of a cent", () => {
    const amounts = ["0.000001", "41280.000000", "0.333333", "17.123456"]
    const facts = rows([], amounts.map((a, i) => costRow(i, a)))
    expect(sumNanos(facts.map((f) => f.costNanos))).toBe(sumNanos(amounts.map((a) => toNanos(a, "cents"))))
    expect(sumNanos(facts.map((f) => f.costNanos))).toBe(toNanos("412.9745679", "usd"))
  })

  it("keeps a combination that appears on only one side", () => {
    // Web search cost has no model and no tokens; Priority Tier usage has tokens and no cost.
    const facts = rows([usageRow(0, { model: "claude-haiku-5-5" })], [costRow(0, "40.000000", { model: null })])
    expect(facts.map((f) => [f.model, f.costNanos, f.inputTokens])).toEqual([
      ["claude-haiku-5-5", BigInt(0), BigInt(1000)],
      ["(no model)", toNanos("0.4", "usd"), BigInt(0)],
    ])
  })

  it("combines distinct products with the same persisted surface", () => {
    const api = { product: "messages_api" }
    const batches = { product: "message_batches_api" }
    const facts = rows([usageRow(0, api), usageRow(0, batches)], [costRow(0, "100", api), costRow(0, "200", batches)])
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ surface: "api", requests: 8, inputTokens: BigInt(2000), costNanos: toNanos(3, "usd") })
  })

  it("maps every kind of actor to a stable identity", () => {
    const of = (actor: unknown) => rows([usageRow(0, { actor })], [])[0]
    expect(of({ type: "user_actor", user_id: "user_9", email_address: null, deleted: true })).toMatchObject({ rawIdentity: "user_9", identityType: "user" })
    expect(of({ type: "service_account_actor", service_account_id: "svac_1" })).toMatchObject({ rawIdentity: "svac_1", identityType: "service_account" })
    expect(of({ type: "api_actor", api_key_id: "apikey_1" })).toMatchObject({ rawIdentity: "apikey_1", identityType: "api_key" })
    expect(of({ type: "federated_actor", provider: { type: "aws", account_id: "1" }, subject: "arn:aws:iam::1:role/ci" }))
      .toMatchObject({ rawIdentity: "federated:aws:arn:aws:iam::1:role/ci", identityType: "service_account" })
    expect(of({ type: "federated_actor" })).toMatchObject({ rawIdentity: "federated:unknown:unknown" })
    expect(of(null)).toMatchObject({ rawIdentity: "unattributed", identityType: "unattributed" })
    expect(of({ type: "some_future_actor" })).toMatchObject({ rawIdentity: "unattributed", identityType: "unattributed" })
    expect(of({ type: "service_account_actor" })).toMatchObject({ rawIdentity: "unattributed" })
    expect(of({ type: "api_actor" })).toMatchObject({ rawIdentity: "unattributed" })
    expect(of({ type: "user_actor" })).toMatchObject({ rawIdentity: "unattributed" })
  })

  it("maps products to surfaces", () => {
    const of = (product: string | null) => rows([usageRow(0, { product })], [])[0].surface
    expect([of("claude_code"), of("managed_agents_api"), of("messages_api"), of("message_batches_api"), of("claude_console"), of(null), of("chat"), of("cowork")])
      .toEqual(["claude_code", "agent", "api", "api", "api", "api", "chat", "chat"])
  })

  it("is idempotent: the same rows, in any order, give the same facts and keys", () => {
    const u = [usageRow(0), usageRow(1), usageRow(0, { product: "messages_api" })]
    const c = [costRow(0, "1.000000"), costRow(1, "2.000000"), costRow(0, "3.000000", { product: "messages_api" })]
    const key = (facts: ReturnType<typeof rows>) => facts.map((f) => `${factDedupeKey("conn", f)}:${f.costNanos}:${f.requests}`).sort()
    expect(key(rows([...u].reverse(), [...c].reverse()))).toEqual(key(rows(u, c)))
    expect(new Set(key(rows(u, c))).size).toBe(3)
  })
})

describe("the anthropic adapter", () => {
  it("pulls whole hours only and passes through Anthropic's own refresh time", async () => {
    const fetchMock = serving([page([usageRow(0)])], [page([costRow(0, "150.000000")])])
    const adapter = adapterFor("anthropic")!
    const pulled = await adapter.pull("k", { startMs: start, endMs: start + 5 * HOUR + 1234 }, { fetch: fetchMock as never, ...noWait })
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("ending_at")).toBe("2026-11-20T05:00:00.000Z")
    expect(pulled).toMatchObject({ fromMs: start, httpCalls: 2, refreshedAt: new Date("2026-11-23T04:00:00Z") })
    expect(pulled.facts).toHaveLength(1)
    expect(adapter.endpoint).toBe("/v1/organizations/analytics/usage + /v1/organizations/analytics/cost")
  })

  it("reads catch-up windows in consecutive ranges of at most 31 days", async () => {
    const cut = start + 31 * 24 * HOUR
    const end = cut + 24 * HOUR
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url)
      const hour = Date.parse(u.searchParams.get("starting_at")!) === start ? 0 : 31 * 24
      const data = u.pathname === ANTHROPIC_USAGE_PATH ? [usageRow(hour)] : [costRow(hour, "150")]
      return json(page(data))
    })
    const pulled = await adapterFor("anthropic")!.pull("k", { startMs: start, endMs: end }, { fetch: fetchMock as never, ...noWait })
    const ranges = fetchMock.mock.calls.map(([url]) => {
      const q = new URL(url).searchParams
      return [Date.parse(q.get("starting_at")!), Date.parse(q.get("ending_at")!)]
    })
    expect(ranges).toEqual([[start, cut], [start, cut], [cut, end], [cut, end]])
    expect(pulled.fromMs).toBe(start)
    expect(pulled.httpCalls).toBe(4)
    expect(pulled.facts.map(f => f.bucketStart.getTime())).toEqual([start, cut])
  })

  it("probes the last 24 whole hours, and Cursor's adapter probes the last hour", async () => {
    const now = new Date(start + 30 * 60_000)
    const fetchMock = serving([page([])], [page([])])
    await adapterFor("anthropic")!.probe("k", now, { fetch: fetchMock as never, ...noWait })
    const q = new URL(fetchMock.mock.calls[0][0] as string).searchParams
    expect([q.get("starting_at"), q.get("ending_at")]).toEqual(["2026-11-19T00:00:00.000Z", "2026-11-20T00:00:00.000Z"])
    const cursorFetch = vi.fn(async () => json({ totalUsageEventsCount: 0, pagination: { hasNextPage: false }, usageEvents: [] }))
    await adapterFor("cursor")!.probe("k", now, { fetch: cursorFetch as never, ...noWait })
    expect(JSON.parse((cursorFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ startDate: now.getTime() - HOUR })
    expect(adapterFor("constructor")).toBeUndefined()
    expect(adapterFor("gemini")).toBeUndefined()
  })
})
