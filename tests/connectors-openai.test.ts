// OpenAI connector: the contract with the organization usage and costs
// endpoints (against the response examples copied from OpenAI's reference),
// the HTTP behavior, and the reconciliation of hourly tokens with daily money.

import { describe, expect, it, vi } from "vitest"
import docs from "./fixtures/openai/usage-costs.docs.json"
import {
  OPENAI_API, OPENAI_COSTS_PATH, OPENAI_USAGE_PATH, allocate, fetchOpenAiUsageAndCosts,
  normalizeOpenAiBuckets, parseOpenAiCostsPage, parseOpenAiUsagePage,
} from "../lib/connectors/openai"
import { adapterFor } from "../lib/connectors/adapters"
import { ConnectorError, factDedupeKey } from "../lib/connectors/facts"
import { evaluateGuardrails } from "../lib/connectors/guardrails"
import { sumNanos, toNanos, usd } from "../lib/connectors/money"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const D0 = Date.UTC(2026, 10, 20)
const noWait = { sleep: async () => {}, take: async () => {} }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })
const page = (data: unknown[], more: string | null = null) => ({ object: "page", data, has_more: more !== null, next_page: more })

type Who = { user_id?: string | null; api_key_id?: string | null }
const usageBucket = (hourFromD0: number, results: (Who & { model?: string | null; input?: number; output?: number; cached?: number; written?: number; requests?: number })[]) => ({
  object: "bucket", start_time: (D0 + hourFromD0 * HOUR) / 1000, end_time: (D0 + (hourFromD0 + 1) * HOUR) / 1000,
  results: results.map((r) => ({
    object: "organization.usage.completions.result", input_tokens: r.input ?? 1000, output_tokens: r.output ?? 0, num_model_requests: r.requests ?? 1,
    input_cached_tokens: r.cached ?? 0, input_cache_write_tokens: r.written ?? 0,
    user_id: "user_id" in r ? r.user_id : "user-a", api_key_id: r.api_key_id ?? null, model: "model" in r ? r.model : "gpt-big",
  })),
})
const costBucket = (dayFromD0: number, results: (Who & { value: number; currency?: string })[]) => ({
  object: "bucket", start_time: (D0 + dayFromD0 * DAY) / 1000, end_time: (D0 + (dayFromD0 + 1) * DAY) / 1000,
  results: results.map((r) => ({
    object: "organization.costs.result", amount: { value: r.value, currency: r.currency ?? "usd" },
    user_id: "user_id" in r ? r.user_id : "user-a", api_key_id: r.api_key_id ?? null,
  })),
})
const normalize = (usage: unknown[], costs: unknown[]) =>
  normalizeOpenAiBuckets(parseOpenAiUsagePage(page(usage)).data, parseOpenAiCostsPage(page(costs)).data)

describe("contract: OpenAI's documented responses", () => {
  it("parses the documented usage and costs examples", () => {
    const usage = parseOpenAiUsagePage(docs.usage)
    expect(usage.data[0].results[0]).toMatchObject({ input_tokens: 1000, input_cached_tokens: 400, input_cache_write_tokens: 100, input_uncached_tokens: 500, output_tokens: 500, num_model_requests: 5 })
    expect(usage).toMatchObject({ has_more: true, next_page: "page_AAAAAGdGxdEiJdKOAAAAAGcqsYA=" })
    const costs = parseOpenAiCostsPage(docs.costs)
    expect(costs.data[0].results[0].amount).toEqual({ value: 0.06, currency: "usd" })
    expect(costs.data[0].start_time).toBe(1730419200)
  })

  it("normalizes the documented examples: tokens split by type, six cents billed", () => {
    const [fact] = normalizeOpenAiBuckets(parseOpenAiUsagePage(docs.usage).data, parseOpenAiCostsPage(docs.costs).data)
    expect(fact).toMatchObject({ provider: "openai", surface: "api", rawIdentity: "unattributed", identityType: "unattributed", model: "(no model)", requests: 5, costBasis: "allocated" })
    expect([fact.inputTokens, fact.cacheReadTokens, fact.cacheWriteTokens, fact.outputTokens]).toEqual([BigInt(500), BigInt(400), BigInt(100), BigInt(500)])
    expect(fact.costNanos).toBe(toNanos("0.06", "usd"))
  })

  it("fails loudly when a field Sanction reads changes type or goes missing", () => {
    const bad = (results: unknown[]) => page([{ start_time: D0 / 1000, end_time: D0 / 1000 + 3600, results }])
    for (const [path, result] of [
      ["data.0.results.0.input_tokens", { output_tokens: 1, num_model_requests: 1 }],
      ["data.0.results.0.output_tokens", { input_tokens: 1, output_tokens: -4, num_model_requests: 1 }],
      ["data.0.results.0.num_model_requests", { input_tokens: 1, output_tokens: 1, num_model_requests: "5" }],
    ] as const) {
      const attempt = () => parseOpenAiUsagePage(bad([result]))
      expect(attempt, path).toThrow(ConnectorError)
      expect(attempt).toThrow(path)
    }
    expect(() => parseOpenAiCostsPage(bad([{ amount: { value: "0.06", currency: "usd" } }]))).toThrow("data.0.results.0.amount.value")
    expect(() => parseOpenAiCostsPage({ data: [] })).toThrow(/has_more/)
    expect(() => parseOpenAiUsagePage(page([{ start_time: "today", end_time: 1, results: [] }]))).toThrow("data.0.start_time")
  })

  it("accepts older responses without the newer token fields, and fields added later", () => {
    const body = page([{ start_time: D0 / 1000, end_time: D0 / 1000 + 3600, results: [{ input_tokens: 900, output_tokens: 100, num_model_requests: 2, input_cached_tokens: 300, brand_new: true }] }])
    const [fact] = normalizeOpenAiBuckets(parseOpenAiUsagePage(body).data, [])
    // No input_uncached_tokens: derived as input minus cached minus cache-write.
    expect([fact.inputTokens, fact.cacheReadTokens, fact.cacheWriteTokens]).toEqual([BigInt(600), BigInt(300), BigInt(0)])
  })
})

describe("fetchOpenAiUsageAndCosts", () => {
  const serving = (usagePages: unknown[], costPages: unknown[]) =>
    vi.fn(async (url: string) => {
      const u = new URL(url)
      const pages = u.pathname === OPENAI_USAGE_PATH ? usagePages : costPages
      return json(pages[Number(u.searchParams.get("page") ?? 0)])
    })

  it("asks for hourly usage and daily costs with a Bearer admin key, in Unix seconds", async () => {
    const fetchMock = serving([page([usageBucket(0, [{}])])], [page([costBucket(0, [{ value: 1 }])])])
    const result = await fetchOpenAiUsageAndCosts("admin-key", { startMs: D0, endMs: D0 + 30 * HOUR + 500 }, { fetch: fetchMock as never, ...noWait })
    expect(result).toMatchObject({ httpCalls: 2 })
    const [usageUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const u = new URL(usageUrl)
    expect(`${u.origin}${u.pathname}`).toBe(`${OPENAI_API}${OPENAI_USAGE_PATH}`)
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ start_time: String(D0 / 1000), end_time: String(Math.ceil((D0 + 30 * HOUR + 500) / 1000)), bucket_width: "1h", limit: "168" })
    expect(u.searchParams.getAll("group_by")).toEqual(["user_id", "api_key_id", "model"])
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer admin-key")
    const c = new URL(fetchMock.mock.calls[1][0] as string)
    expect(c.pathname).toBe(OPENAI_COSTS_PATH)
    expect(Object.fromEntries(c.searchParams)).toMatchObject({ bucket_width: "1d", limit: "180" })
    // No model on the cost side: OpenAI does not offer it.
    expect(c.searchParams.getAll("group_by")).toEqual(["user_id", "api_key_id", "line_item"])
  })

  it("follows the cursor on each endpoint", async () => {
    const fetchMock = serving([page([usageBucket(0, [{}])], "1"), page([usageBucket(1, [{}])], "2"), page([usageBucket(2, [{}])])], [page([costBucket(0, [{ value: 1 }])], "1"), page([])])
    const result = await fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 + DAY }, { fetch: fetchMock as never, ...noWait })
    expect([result.usage.length, result.costs.length, result.httpCalls]).toEqual([3, 1, 5])
  })

  it("makes no request for an empty window", async () => {
    const fetchMock = vi.fn()
    expect(await fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 }, { fetch: fetchMock as never, ...noWait })).toMatchObject({ httpCalls: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps provider failures to something the connect screen can act on, without echoing the key", async () => {
    const cases: [Response | Error, string][] = [
      [json({ error: { message: "Incorrect API key provided: sk-admin-supersecret" } }, 401), "bad_key"],
      [json({ error: {} }, 403), "plan_unsupported"],
      [json({ error: {} }, 400), "unexpected_response"],
      [json({}, 502), "provider_unavailable"],
      [new TypeError("fetch failed"), "provider_unavailable"],
      [new Response("<html>", { status: 200 }), "unexpected_response"],
    ]
    for (const [outcome, kind] of cases) {
      const fetchMock = vi.fn(async () => {
        if (outcome instanceof Error) throw outcome
        return outcome.clone()
      })
      const error = await fetchOpenAiUsageAndCosts("sk-admin-supersecret", { startMs: D0, endMs: D0 + HOUR }, { fetch: fetchMock as never, ...noWait }).catch((e) => e)
      expect(error).toMatchObject({ kind })
      expect(String(error.message)).not.toContain("supersecret")
    }
  })

  it("waits once on a 429, and stops on a cursor that never ends or goes missing", async () => {
    const sleep = vi.fn(async () => {})
    const recovered = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "7" })).mockImplementation(async () => json(page([])))
    const retried = await fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 + HOUR }, { fetch: recovered as never, sleep, take: async () => {} })
    expect(retried.httpCalls).toBe(3)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(7000)
    await expect(fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 + HOUR }, { fetch: vi.fn(async () => json({}, 429)) as never, sleep, take: async () => {} })).rejects.toMatchObject({ kind: "rate_limited" })
    const forever = vi.fn(async () => json(page([], "0")))
    await expect(fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 + HOUR }, { fetch: forever as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
    expect(forever.mock.calls.length).toBeLessThanOrEqual(200)
    const broken = vi.fn(async () => json({ ...page([]), has_more: true }))
    await expect(fetchOpenAiUsageAndCosts("k", { startMs: D0, endMs: D0 + HOUR }, { fetch: broken as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
  })
})

describe("allocate", () => {
  it("splits in proportion and always sums to exactly the total", () => {
    expect(allocate(BigInt(100), [BigInt(1), BigInt(1)])).toEqual([BigInt(50), BigInt(50)])
    expect(allocate(BigInt(100), [BigInt(3), BigInt(1)])).toEqual([BigInt(75), BigInt(25)])
    // 10 over three equal weights: the spare nano goes to the first.
    expect(allocate(BigInt(10), [BigInt(1), BigInt(1), BigInt(1)])).toEqual([BigInt(4), BigInt(3), BigInt(3)])
    expect(allocate(BigInt(0), [BigInt(5), BigInt(7)])).toEqual([BigInt(0), BigInt(0)])
    expect(allocate(BigInt(7), [BigInt(0), BigInt(9)])).toEqual([BigInt(0), BigInt(7)])
    expect(() => allocate(BigInt(1), [BigInt(0)])).toThrow()
    expect(() => allocate(BigInt(-1), [BigInt(1)])).toThrow()
  })

  it("property: random totals and weights always conserve the total, and a larger weight never gets less", () => {
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 500; i++) {
      const weights = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => BigInt(1 + Math.floor(rand() * 1e9)))
      const total = BigInt(Math.floor(rand() * 1e12))
      const parts = allocate(total, weights)
      expect(sumNanos(parts)).toBe(total)
      for (let a = 0; a < weights.length; a++) for (let b = 0; b < weights.length; b++) if (weights[a] > weights[b]) expect(parts[a] >= parts[b]).toBe(true)
    }
  })
})

describe("normalizeOpenAiBuckets: daily money onto hourly tokens", () => {
  it("spreads a person's billed day across their hours by token share, exactly", () => {
    const facts = normalize(
      [usageBucket(9, [{ input: 3000, output: 0 }]), usageBucket(10, [{ input: 500, output: 500, model: "gpt-small" }])],
      [costBucket(0, [{ value: 8 }])],
    )
    expect(facts.map((f) => [f.bucketStart.toISOString().slice(11, 16), f.model, f.costNanos, f.costBasis])).toEqual([
      ["09:00", "gpt-big", usd(6), "allocated"],
      ["10:00", "gpt-small", usd(2), "allocated"],
    ])
    expect(facts.every((f) => f.rawIdentity === "user-a" && f.identityType === "user" && f.bucketEnd.getTime() - f.bucketStart.getTime() === HOUR)).toBe(true)
  })

  it("conserves OpenAI's billed total per person and per day, to the nano", () => {
    const usage = Array.from({ length: 48 }, (_, h) => usageBucket(h, [{ input: 1000 + h * 37, output: 11 * h }, { user_id: "user-b", input: 777 + h, model: "gpt-small" }]))
    const costs = [costBucket(0, [{ value: 12.345678 }, { user_id: "user-b", value: 0.07 }]), costBucket(1, [{ value: 3.1 }, { user_id: "user-b", value: 41.99 }])]
    const facts = normalize(usage, costs)
    const total = (who: string, day: number) => sumNanos(facts.filter((f) => f.rawIdentity === who && Math.floor((f.bucketStart.getTime() - D0) / DAY) === day).map((f) => f.costNanos))
    expect(total("user-a", 0)).toBe(toNanos("12.345678", "usd"))
    expect(total("user-b", 0)).toBe(toNanos("0.07", "usd"))
    expect(total("user-a", 1)).toBe(toNanos("3.1", "usd"))
    expect(total("user-b", 1)).toBe(toNanos("41.99", "usd"))
    expect(facts.every((f) => f.costBasis === "allocated")).toBe(true)
  })

  it("estimates a day OpenAI has not priced yet from the person's own recent cost per token", () => {
    // Day 0 is priced: $10 for 10,000 tokens. Day 1 (today) has no cost rows at all.
    const facts = normalize(
      [usageBucket(5, [{ input: 10_000 }]), usageBucket(24 + 3, [{ input: 4000 }]), usageBucket(24 + 4, [{ user_id: "user-new", input: 1000 }])],
      [costBucket(0, [{ value: 10 }])],
    )
    const today = facts.filter((f) => f.bucketStart.getTime() >= D0 + DAY)
    expect(today.map((f) => [f.rawIdentity, f.costNanos, f.costBasis])).toEqual([
      ["user-a", usd(4), "estimated"],
      // No history of their own: the organization's rate.
      ["user-new", usd(1), "estimated"],
    ])
  })

  it("an unpriced day with no priced history anywhere is zero, still marked as an estimate", () => {
    const [fact] = normalize([usageBucket(1, [{ input: 5000 }])], [])
    expect(fact).toMatchObject({ costNanos: BigInt(0), costBasis: "estimated" })
  })

  it("on a priced day, a person with tokens and no cost row cost nothing", () => {
    const facts = normalize([usageBucket(1, [{ input: 5000 }, { user_id: "user-free", input: 9000 }])], [costBucket(0, [{ value: 2 }])])
    expect(facts.find((f) => f.rawIdentity === "user-free")).toMatchObject({ costNanos: BigInt(0), costBasis: "billed" })
    expect(facts.find((f) => f.rawIdentity === "user-a")!.costNanos).toBe(usd(2))
  })

  it("cost with no completions usage (embeddings, images) becomes one day-long row, so no money is dropped", () => {
    const facts = normalize([usageBucket(2, [{ input: 100 }])], [costBucket(0, [{ value: 1 }, { user_id: "user-embed", value: 30 }])])
    const other = facts.find((f) => f.rawIdentity === "user-embed")!
    expect(other).toMatchObject({ model: "(other usage)", costNanos: usd(30), costBasis: "billed", requests: 0 })
    expect(other.bucketEnd.getTime() - other.bucketStart.getTime()).toBe(DAY)
    expect(sumNanos(facts.map((f) => f.costNanos))).toBe(usd(31))
  })

  it("a credit (negative cost) is kept as its own row, never spread over hours", () => {
    const facts = normalize([usageBucket(2, [{ input: 100 }])], [costBucket(0, [{ value: -5 }])])
    expect(facts.find((f) => f.model === "(credit)")!.costNanos).toBe(usd(-5))
    expect(facts.find((f) => f.model === "gpt-big")!.costNanos).toBe(BigInt(0))
  })

  it("keeps charges and credits distinct on a mixed day with or without usage", () => {
    const costs = [costBucket(0, [{ value: 100 }, { value: -95 }])]
    for (const usage of [[], [usageBucket(2, [{}])]]) {
      const facts = normalize(usage, costs)
      expect(facts).toHaveLength(2)
      expect(sumNanos(facts.map(f => f.costNanos))).toBe(usd(5))
      expect(facts.find(f => f.costNanos > 0)?.costNanos).toBe(usd(100))
      const credit = facts.find(f => f.model === "(credit)")!
      expect(credit.costNanos).toBe(usd(-95))
      expect(credit.bucketEnd.getTime() - credit.bucketStart.getTime()).toBe(DAY)
    }
  })

  it("allocates a single remaining nano to the same hour and model after reordering", () => {
    const a = usageBucket(1, [{ model: "b" }, { model: "a" }])
    const b = usageBucket(2, [{}])
    const costs = [costBucket(0, [{ value: 0.000000001 }])]
    const facts = normalize([a, b], costs)
    expect(facts.find(f => f.costNanos === BigInt(1))?.model).toBe("a")
    expect(normalize([b, { ...a, results: [...a.results].reverse() }], costs)).toEqual(facts)
  })

  it("identifies by user, else API key, else unattributed, the same way on both sides", () => {
    const facts = normalize(
      [usageBucket(0, [{ user_id: null, api_key_id: "key_1" }, { user_id: null }, { user_id: "user-a", api_key_id: "key_9" }])],
      [costBucket(0, [{ user_id: null, api_key_id: "key_1", value: 3 }, { user_id: null, value: 4 }, { user_id: "user-a", api_key_id: "key_9", value: 5 }])],
    )
    expect(facts.map((f) => [f.rawIdentity, f.identityType, f.costNanos]).sort()).toEqual([
      ["key_1", "api_key", usd(3)], ["unattributed", "unattributed", usd(4)], ["user-a", "user", usd(5)],
    ].sort())
  })

  it("refuses a currency it cannot convert, and skips a result with no amount", () => {
    expect(() => normalize([], [costBucket(0, [{ value: 5, currency: "eur" }])])).toThrow(ConnectorError)
    expect(normalize([], [costBucket(0, [{ value: 5, currency: "USD" }])])[0].costNanos).toBe(usd(5))
    const noAmount = page([{ start_time: D0 / 1000, end_time: D0 / 1000 + 86400, results: [{ user_id: "user-a" }] }])
    expect(normalizeOpenAiBuckets([], parseOpenAiCostsPage(noAmount).data)).toEqual([])
  })

  it("is idempotent and order-independent", () => {
    const usage = [usageBucket(1, [{ input: 10 }]), usageBucket(2, [{ input: 30 }, { user_id: "user-b", input: 5 }]), usageBucket(2, [{ input: 60 }])]
    const costs = [costBucket(0, [{ value: 1 }, { user_id: "user-b", value: 2 }])]
    const key = (f: ReturnType<typeof normalize>) => f.map((x) => `${factDedupeKey("c", x)}:${x.costNanos}:${x.inputTokens}`)
    expect(key(normalize([...usage].reverse(), [...costs].reverse()))).toEqual(key(normalize(usage, costs)))
    // Two results for the same hour, person and model merge into one fact.
    expect(normalize(usage, costs).filter((f) => f.rawIdentity === "user-a")).toHaveLength(2)
  })
})

describe("guardrails over OpenAI facts", () => {
  it("a day-long row counts toward a person's daily line and never reads as an hourly spike", () => {
    const facts = normalize([], [costBucket(0, [{ value: 80 }])]).map((f) => ({
      provider: f.provider, rawIdentity: f.rawIdentity, model: f.model, sessionRef: null, automationRef: null, headless: false,
      human: f.identityType === "user", hourly: f.bucketEnd.getTime() - f.bucketStart.getTime() === HOUR,
      bucketStartMs: f.bucketStart.getTime(), costNanos: f.costNanos, billed: true,
    }))
    expect(evaluateGuardrails(facts, D0).map((a) => a.rule)).toEqual(["daily_cap"])
  })
})

describe("the openai adapter", () => {
  it("re-reads whole UTC days and reports where its facts begin", async () => {
    const fetchMock = vi.fn(async () => json(page([])))
    const adapter = adapterFor("openai")!
    const pulled = await adapter.pull("k", { startMs: D0 + 7 * HOUR, endMs: D0 + 30 * HOUR }, { fetch: fetchMock as never, ...noWait })
    expect(pulled).toMatchObject({ fromMs: D0, httpCalls: 2, refreshedAt: null, facts: [] })
    expect(new URL((fetchMock.mock.calls[0] as unknown as [string])[0]).searchParams.get("start_time")).toBe(String(D0 / 1000))
    await adapter.probe("k", new Date(D0 + 5 * HOUR), { fetch: fetchMock as never, ...noWait })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(adapter.endpoint).toBe("/v1/organization/usage/completions + /v1/organization/costs")
  })
})
