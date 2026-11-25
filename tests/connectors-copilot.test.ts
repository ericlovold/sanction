// GitHub Copilot connector: the contract with GitHub's billing usage and
// usage metrics report endpoints, the HTTP behavior (including that the
// GitHub token never goes to a report download link), and the split of a
// billed day across people.
//
// Fixtures are CONSTRUCTED from the field lists on docs.github.com
// (rest/billing/usage and copilot/reference/copilot-usage-metrics), read on
// 2026-11-25. They are not copies of GitHub's examples: replace them with
// recorded responses from a real organization before this ships.

import { describe, expect, it, vi } from "vitest"
import {
  COPILOT_AI_CREDIT_PATH, COPILOT_PREMIUM_REQUEST_PATH, COPILOT_USERS_REPORT_PATH, GITHUB_API, GITHUB_ORG_LOGIN,
  fetchCopilotDays, normalizeCopilotDays, parseCopilotUserReport, probeCopilot, type CopilotDay,
} from "../lib/connectors/copilot"
import { adapterFor } from "../lib/connectors/adapters"
import { ConnectorError, factDedupeKey, isBilledCost } from "../lib/connectors/facts"
import { evaluateGuardrails } from "../lib/connectors/guardrails"
import { sumNanos, toNanos } from "../lib/connectors/money"
import { usageProvider } from "../lib/connectors/registry"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const D0 = Date.UTC(2026, 10, 20) // 2026-11-20
const noWait = { sleep: async () => {}, take: async () => {} }
const cred = { secret: "github_pat_test_token_value", accountRef: "acme-co" }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

// One billed line, shaped like the documented usageItems[] entry.
const item = (model: string | null, net: number | string, discount: number | string = 0) => ({
  product: "copilot", sku: "copilot_ai_credit", model, unitType: "credits", pricePerUnit: 0.01,
  grossQuantity: 100, grossAmount: 1, discountQuantity: 0, discountAmount: discount, netQuantity: 100, netAmount: net,
})
// One report record, shaped like the documented per-user record (subset).
const record = (login: string, credits: number | null, day = "2026-11-20") => ({
  day, organization_id: "1", user_id: 7, user_login: login, ai_credits_used: credits,
  user_initiated_interaction_count: 3, code_generation_activity_count: 2, used_agent: true,
})
const ndjson = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n")

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>
// Routes GitHub API calls by path and report downloads by host, and records
// every call so tests can assert what was sent where.
function github(routes: { credit?: Route; premium?: Route; report?: Route; download?: Route }) {
  const ok: Route = () => json({ usageItems: [] })
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.host === "reports.example-storage.net") return (routes.download ?? (() => new Response("")))(url, init)
    if (url.pathname.endsWith("/ai_credit/usage")) return (routes.credit ?? ok)(url, init)
    if (url.pathname.endsWith("/premium_request/usage")) return (routes.premium ?? ok)(url, init)
    if (url.pathname.endsWith("/users-1-day")) return (routes.report ?? (() => new Response(null, { status: 204 })))(url, init)
    throw new Error(`unrouted ${url}`)
  })
}
const links = (day: string, ...names: string[]) => json({ download_links: names.map((n) => `https://reports.example-storage.net/${n}?sig=abc`), report_day: day })

describe("contract: GitHub's documented shapes", () => {
  it("reads a usage report as NDJSON, as a JSON array, and as lines that are arrays", () => {
    const a = record("Ana", 10)
    const b = record("bo", 5)
    expect(parseCopilotUserReport(ndjson(a, b)).map((r) => r.user_login)).toEqual(["Ana", "bo"])
    expect(parseCopilotUserReport(JSON.stringify([a, b])).map((r) => r.user_login)).toEqual(["Ana", "bo"])
    expect(parseCopilotUserReport(`${JSON.stringify([a])}\n${JSON.stringify(b)}\n`).map((r) => r.user_login)).toEqual(["Ana", "bo"])
    expect(parseCopilotUserReport("  \n")).toEqual([])
  })

  it("fails loudly when a record Sanction reads changes shape, without echoing values", () => {
    const err = (() => {
      try {
        parseCopilotUserReport(ndjson({ user_login: "secret-login", ai_credits_used: "lots" }))
      } catch (e) {
        return e as ConnectorError
      }
    })()
    expect(err).toBeInstanceOf(ConnectorError)
    expect(err?.kind).toBe("unexpected_response")
    expect(err?.message).toContain("ai_credits_used")
    expect(err?.message).not.toContain("secret-login")
    expect(() => parseCopilotUserReport("{not json\n{also not")).toThrow(/valid JSON lines/)
  })

  it("accepts organization logins GitHub allows and nothing else", () => {
    for (const ok of ["acme", "acme-co", "a", "A1-b2", "x".repeat(39)]) expect(GITHUB_ORG_LOGIN.test(ok)).toBe(true)
    for (const bad of ["", "-acme", "acme-", "ac--me", "acme/../x", "acme co", "x".repeat(40), "acme?x=1"]) expect(GITHUB_ORG_LOGIN.test(bad)).toBe(false)
  })
})

describe("splitting a billed day across people", () => {
  const day = (items: ReturnType<typeof item>[], users: ReturnType<typeof record>[] | null): CopilotDay => ({
    dayMs: D0,
    items,
    users: users === null ? null : parseCopilotUserReport(ndjson(...users)),
  })

  it("keeps every billed nano-dollar: each model's parts sum exactly to GitHub's net amount", () => {
    const facts = normalizeCopilotDays([day([item("gpt-5", "10.00"), item("claude-sonnet", 3.333333333), item("gpt-5", 0.01)], [record("ana", 7), record("bo", 2), record("cy", 1)])])
    for (const model of ["gpt-5", "claude-sonnet"]) {
      const billed = facts.filter((f) => f.model === model && f.costBasis === "allocated")
      const expected = model === "gpt-5" ? toNanos("10.01", "usd") : toNanos(3.333333333, "usd")
      expect(sumNanos(billed.map((f) => f.costNanos))).toBe(expected)
    }
    // Shares follow credits: ana used 70%, so 70% of gpt-5's $10.01.
    const ana = facts.find((f) => f.rawIdentity === "github:ana" && f.model === "gpt-5")!
    expect(ana.costNanos).toBe(toNanos("7.007", "usd"))
    expect(facts.every((f) => f.provider === "copilot" && f.surface === "ide" && f.bucketEnd.getTime() - f.bucketStart.getTime() === DAY)).toBe(true)
    expect(facts.every((f) => f.inputTokens === BigInt(0) && f.requests === 0)).toBe(true)
  })

  it("splits plan-included usage the same way and keeps it apart from billed money", () => {
    const facts = normalizeCopilotDays([day([item("gpt-5", 0, "4.00")], [record("ana", 3), record("bo", 1)])])
    expect(facts.map((f) => [f.rawIdentity, f.costBasis, f.costNanos])).toEqual([
      ["github:ana", "included", toNanos(3, "usd")],
      ["github:bo", "included", toNanos(1, "usd")],
    ])
    expect(facts.some((f) => isBilledCost(f.costBasis))).toBe(false)
  })

  it("keeps a day's money whole and unattributed until GitHub publishes the report", () => {
    const pending = normalizeCopilotDays([day([item("gpt-5", "5.00", "1.00")], null)])
    expect(pending.map((f) => [f.rawIdentity, f.identityType, f.costBasis, f.costNanos])).toEqual([
      ["unattributed", "unattributed", "billed", toNanos(5, "usd")],
      ["unattributed", "unattributed", "included", toNanos(1, "usd")],
    ])
    // A report where nobody used credits is the same: nothing to split by.
    const idle = normalizeCopilotDays([day([item("gpt-5", "5.00")], [record("ana", 0), record("bo", null)])])
    expect(idle).toHaveLength(1)
    expect(idle[0]).toMatchObject({ rawIdentity: "unattributed", costBasis: "billed" })
  })

  it("never splits a refund or correction", () => {
    const facts = normalizeCopilotDays([day([item("gpt-5", "-2.50")], [record("ana", 5)])])
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ rawIdentity: "unattributed", costBasis: "billed", costNanos: toNanos("-2.50", "usd") })
  })

  it("treats GitHub logins as case-insensitive and names a model-less line", () => {
    const facts = normalizeCopilotDays([day([item(null, "1.00")], [record("Ana", 1), record("ana", 1), record("BO", 2)])])
    expect(facts.map((f) => [f.rawIdentity, f.model, f.costNanos])).toEqual([
      ["github:ana", "(no model)", toNanos("0.5", "usd")],
      ["github:bo", "(no model)", toNanos("0.5", "usd")],
    ])
  })

  it("is deterministic: the same day in any order gives the same rows", () => {
    const items = [item("a", 1), item("b", 2), item("a", 3)]
    const users = [record("x", 1), record("y", 3), record("z", 7)]
    const key = (fs: ReturnType<typeof normalizeCopilotDays>) => fs.map((f) => `${factDedupeKey("c", f)}:${f.costNanos}`)
    expect(key(normalizeCopilotDays([day([...items].reverse(), [...users].reverse())]))).toEqual(key(normalizeCopilotDays([day(items, users)])))
    expect(new Set(key(normalizeCopilotDays([day(items, users)])).map((k) => k.split(":")[0])).size).toBe(6)
  })

  it("a person's allocated day counts toward the daily line and never reads as an hourly spike", () => {
    const facts = normalizeCopilotDays([day([item("gpt-5", "90.00")], [record("ana", 1)])]).map((f) => ({
      provider: f.provider, rawIdentity: f.rawIdentity, model: f.model, sessionRef: null, automationRef: null, headless: false,
      human: f.identityType === "user", hourly: f.bucketEnd.getTime() - f.bucketStart.getTime() === HOUR,
      bucketStartMs: f.bucketStart.getTime(), costNanos: f.costNanos, billed: isBilledCost(f.costBasis),
    }))
    expect(evaluateGuardrails(facts, D0).map((a) => a.rule)).toEqual(["daily_cap"])
  })
})

describe("talking to GitHub", () => {
  it("sends the documented headers to the API, one call per endpoint per UTC day", async () => {
    const fetchMock = github({})
    const pulled = await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 2 * DAY }, { fetch: fetchMock as never, ...noWait })
    expect(pulled.days.map((d) => d.dayMs)).toEqual([D0, D0 + DAY])
    expect(pulled.httpCalls).toBe(6)
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls).toContain(`${GITHUB_API}${COPILOT_AI_CREDIT_PATH.replace("{org}", "acme-co")}?year=2026&month=11&day=20`)
    expect(urls).toContain(`${GITHUB_API}${COPILOT_PREMIUM_REQUEST_PATH.replace("{org}", "acme-co")}?year=2026&month=11&day=21`)
    expect(urls).toContain(`${GITHUB_API}${COPILOT_USERS_REPORT_PATH.replace("{org}", "acme-co")}?day=2026-11-20`)
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toEqual({
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", Authorization: `Bearer ${cred.secret}`,
      })
    }
  })

  it("never sends the GitHub token to a report download link", async () => {
    const fetchMock = github({
      report: () => links("2026-11-20", "part-1.ndjson", "part-2.ndjson"),
      download: (url) => new Response(url.pathname.includes("part-1") ? ndjson(record("ana", 2)) : ndjson(record("bo", 1))),
    })
    const pulled = await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })
    expect(pulled.days[0].users?.map((u) => u.user_login)).toEqual(["ana", "bo"])
    const downloads = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("https://reports.example-storage.net/"))
    expect(downloads).toHaveLength(2)
    for (const [, init] of downloads) {
      expect(JSON.stringify(init)).not.toContain(cred.secret)
      expect((init as RequestInit).headers).toBeUndefined()
    }
  })

  it("refuses a report link that is not https", async () => {
    const fetchMock = github({ report: () => json({ download_links: ["http://reports.example-storage.net/x"], report_day: "2026-11-20" }) })
    await expect(fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("http://"))).toBe(false)
  })

  it("treats a missing report (204 or 404) as not published yet", async () => {
    for (const status of [204, 404]) {
      const fetchMock = github({ report: () => new Response(null, { status }) })
      const pulled = await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })
      expect(pulled.days[0].users).toBeNull()
    }
  })

  it("rejects a report for a different day than the one asked for", async () => {
    const fetchMock = github({ report: () => links("2026-11-19", "x") })
    await expect(fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })).rejects.toMatchObject({ kind: "unexpected_response" })
  })

  it("maps GitHub's refusals to what the connect screen can act on", async () => {
    const run = (credit: Route) => fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: github({ credit }) as never, ...noWait })
    await expect(run(() => json({ message: "Bad credentials" }, 401))).rejects.toMatchObject({ kind: "bad_key" })
    const forbidden = await run(() => json({ message: "Resource not accessible" }, 403)).then(() => null, (e: ConnectorError) => e)
    expect(forbidden).toMatchObject({ kind: "plan_unsupported" })
    expect(forbidden?.message).toMatch(/Administration.*Organization Copilot metrics.*acme-co.*policy/)
    await expect(run(() => json({ message: "Not Found" }, 404))).rejects.toMatchObject({ kind: "bad_key", message: expect.stringContaining("acme-co") })
    await expect(run(() => json({ message: "boom" }, 502))).rejects.toMatchObject({ kind: "provider_unavailable" })
    await expect(run(() => new Response("<html>", { status: 200 }))).rejects.toMatchObject({ kind: "unexpected_response" })
  })

  it("reads a 404 on the legacy premium request endpoint as no legacy billing", async () => {
    const fetchMock = github({ credit: () => json({ usageItems: [item("gpt-5", 1)] }), premium: () => json({ message: "Not Found" }, 404) })
    const pulled = await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })
    expect(pulled.days[0].items).toHaveLength(1)
  })

  it("adds legacy premium request billing to AI credit billing for the same day", async () => {
    const fetchMock = github({ credit: () => json({ usageItems: [item("gpt-5", 1)] }), premium: () => json({ usageItems: [item("gpt-5", 2)] }) })
    const pulled = await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })
    const [f] = normalizeCopilotDays(pulled.days)
    expect(f.costNanos).toBe(toNanos(3, "usd"))
  })

  it("waits once on a rate limit (429, or 403 with none left), then gives up", async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    let calls = 0
    const recovering = github({ credit: () => (++calls === 1 ? json({}, 429, { "retry-after": "5" }) : json({ usageItems: [] })) })
    await fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: recovering as never, sleep, take: async () => {} })
    expect(sleep).toHaveBeenCalledWith(5000)

    const stuck = github({ credit: () => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) }) })
    sleep.mockClear()
    await expect(fetchCopilotDays(cred, { startMs: D0, endMs: D0 + 1 }, { fetch: stuck as never, sleep, take: async () => {} })).rejects.toMatchObject({ kind: "rate_limited" })
    // Never waits longer than 90 seconds, whatever GitHub's reset time says.
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(90_000)
  })

  it("refuses to pull without a valid organization, before any request", async () => {
    const fetchMock = github({})
    for (const accountRef of [null, "", "../admin"]) {
      await expect(fetchCopilotDays({ ...cred, accountRef }, { startMs: D0, endMs: D0 + 1 }, { fetch: fetchMock as never, ...noWait })).rejects.toMatchObject({ kind: "missing_credential" })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("probe proves both permissions: today's bill and yesterday's report", async () => {
    const fetchMock = github({})
    await probeCopilot(cred, new Date(D0 + 5 * HOUR), { fetch: fetchMock as never, ...noWait })
    expect(fetchMock.mock.calls.map(([u]) => new URL(String(u)).search)).toEqual(["?year=2026&month=11&day=20", "?day=2026-11-19"])
    const blocked = github({ report: () => json({ message: "Copilot metrics disabled" }, 403) })
    await expect(probeCopilot(cred, new Date(D0), { fetch: blocked as never, ...noWait })).rejects.toMatchObject({ kind: "plan_unsupported" })
  })
})

describe("the copilot adapter", () => {
  it("re-reads whole UTC days and reports where its facts begin", async () => {
    const fetchMock = github({
      credit: () => json({ usageItems: [item("gpt-5", 2)] }),
      report: (url) => links(url.searchParams.get("day")!, "p"),
      download: () => new Response(ndjson(record("ana", 1))),
    })
    const pulled = await adapterFor("copilot")!.pull(cred, { startMs: D0 + 7 * HOUR, endMs: D0 + DAY + 3 * HOUR }, { fetch: fetchMock as never, ...noWait })
    expect(pulled.fromMs).toBe(D0)
    expect(pulled.facts.map((f) => [f.bucketStart.getTime(), f.rawIdentity, f.costBasis])).toEqual([
      [D0, "github:ana", "allocated"],
      [D0 + DAY, "github:ana", "allocated"],
    ])
    expect(pulled.httpCalls).toBe(8)
  })

  it("is registered with an organization field and the token wording", () => {
    const p = usageProvider("copilot")!
    expect(p.account?.label).toBe("GitHub organization")
    expect(p.keyNoun).toBe("token")
    expect(p.overlapHours).toBeGreaterThanOrEqual(72)
  })
})
