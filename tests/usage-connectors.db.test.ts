// What mocks cannot prove about the usage connectors, against real Postgres
// as the restricted app role: RLS isolation of usage data, an idempotent
// re-pull, alert dedupe across polls, and the failure path leaving stored
// data alone.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/usage-connectors.db.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "../lib/db"
import { withTenant } from "../lib/rls"
import { encryptCredentialEnvelope } from "../lib/credentialCrypto"
import { GATEWAY_ONLY_SENTINEL } from "../lib/providers"
import { usageVaultLabel } from "../lib/connectors/registry"
import { dueConnections, syncConnection } from "../lib/connectors/sync"
import { aiSpendView } from "../lib/connectors/spendView"
import { usd } from "../lib/connectors/money"
import { INCIDENT_CONVERSATION, INCIDENT_HOURS, INCIDENT_START, baselineEvents, incidentEvents } from "./helpers/cursor-incident"

const mocks = vi.hoisted(() => ({ email: vi.fn(async () => {}) }))
vi.mock("@/lib/email", () => ({ sendUsageAlertEmail: mocks.email }))

const run = process.env.RUN_DB_TESTS === "1"
const HOUR = 3_600_000

// A stand-in for Cursor's endpoint that honors the documented request: the
// inclusive date window and 1-indexed pages.
function cursorServing(events: Record<string, unknown>[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { startDate, endDate, page, pageSize } = JSON.parse(init.body as string)
    const matching = events.filter((e) => Number(e.timestamp) >= startDate && Number(e.timestamp) <= endDate)
    const slice = matching.slice((page - 1) * pageSize, page * pageSize)
    return new Response(
      JSON.stringify({ totalUsageEventsCount: matching.length, pagination: { hasNextPage: page * pageSize < matching.length }, usageEvents: slice }),
      { status: 200 },
    )
  })
}
const fast = { sleep: async () => {}, take: async () => {} }

describe.skipIf(!run)("usage connectors against Postgres", () => {
  let walletA = ""
  let walletB = ""
  let connectionA = ""
  let connectionB = ""
  let walletC = ""
  let connectionC = ""
  let walletD = ""
  let connectionD = ""
  const all = [...baselineEvents(), ...incidentEvents()] as Record<string, unknown>[]
  const afterIncident = new Date(INCIDENT_START + INCIDENT_HOURS * HOUR + 10 * 60_000)

  async function seed(name: string, provider = "cursor") {
    const wallet = await db.wallet.create({ data: { name, ownerEmail: `${crypto.randomUUID()}@example.test` } })
    const connection = await db.usageConnection.create({ data: { walletId: wallet.id, provider, authKind: "admin_api_key" } })
    const label = usageVaultLabel(provider, connection.id)
    const { blob, keyId } = await encryptCredentialEnvelope("crsr_test_key_for_db_tests", wallet.id, label)
    const credential = await withTenant(wallet.id, (tx) =>
      tx.credentialVault.create({
        data: { walletId: wallet.id, label, type: "api_key", encryptedValue: blob, keyId, allowedAgentIds: [GATEWAY_ONLY_SENTINEL], minClearance: 5 },
      }),
    )
    await db.usageConnection.update({ where: { id: connection.id }, data: { credentialId: credential.id } })
    return { walletId: wallet.id, connectionId: connection.id }
  }

  const facts = (walletId: string) => withTenant(walletId, (tx) => tx.usageFact.findMany({ orderBy: { dedupeKey: "asc" } }))

  beforeAll(async () => {
    const a = await seed("usage-a")
    const b = await seed("usage-b")
    walletA = a.walletId
    connectionA = a.connectionId
    walletB = b.walletId
    connectionB = b.connectionId
    const c = await seed("usage-c", "anthropic")
    walletC = c.walletId
    connectionC = c.connectionId
    const d = await seed("usage-d", "openai")
    walletD = d.walletId
    connectionD = d.connectionId
  })

  afterAll(async () => {
    if (!run) return
    for (const walletId of [walletA, walletB, walletC, walletD]) {
      await withTenant(walletId, async (tx) => {
        await tx.usageFact.deleteMany({ where: { walletId } })
        await tx.usageAlert.deleteMany({ where: { walletId } })
        await tx.usageSyncRun.deleteMany({ where: { walletId } })
        await tx.credentialVault.deleteMany({ where: { walletId } })
      })
      await db.usageConnection.deleteMany({ where: { walletId } })
      await db.walletKey.deleteMany({ where: { walletId } })
      await db.wallet.delete({ where: { id: walletId } })
    }
  })

  it("the first pull backfills history, stores exact money, and raises the incident's alerts", async () => {
    const fetchMock = cursorServing(all)
    const result = await syncConnection(connectionA, { trigger: "connect_test", actorEmail: "admin@example.test", now: afterIncident, http: { fetch: fetchMock as never, ...fast } })
    expect(result).toMatchObject({ ok: true, alertsRaised: 3 })

    const stored = await facts(walletA)
    const incident = stored.filter((f) => f.sessionRef === INCIDENT_CONVERSATION)
    expect(incident).toHaveLength(INCIDENT_HOURS)
    expect(incident.reduce((s, f) => s + f.costNanos, BigInt(0))).toBe(usd(140))
    expect(incident.every((f) => f.headless && f.surface === "agent" && f.costBasis === "billed")).toBe(true)

    const alerts = await withTenant(walletA, (tx) => tx.usageAlert.findMany({ where: { walletId: walletA } }))
    expect(alerts.map((a) => a.rule).sort()).toEqual(["daily_cap", "headless_burn", "runaway_rate"])
    expect(alerts.every((a) => a.notifiedAt)).toBe(true)
    expect(mocks.email).toHaveBeenCalledOnce()

    const connection = await db.usageConnection.findUniqueOrThrow({ where: { id: connectionA } })
    expect(connection).toMatchObject({ status: "active", statusCode: null })
    expect(connection.syncedThrough?.getTime()).toBe(afterIncident.getTime())
  })

  it("pulling the same data again changes nothing: same rows, same totals, no new alerts, no second email", async () => {
    const before = await facts(walletA)
    mocks.email.mockClear()
    const result = await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + HOUR), http: { fetch: cursorServing(all) as never, ...fast } })
    expect(result).toMatchObject({ ok: true, alertsRaised: 0 })
    const after = await facts(walletA)
    const shape = (rows: typeof after) => rows.map((f) => [f.dedupeKey, f.costNanos, f.requests, f.inputTokens])
    expect(shape(after)).toEqual(shape(before))
    expect(mocks.email).not.toHaveBeenCalled()
    expect(await withTenant(walletA, (tx) => tx.usageAlert.count({ where: { walletId: walletA } }))).toBe(3)
  })

  it("a revised provider figure replaces the stored one inside the re-read window", async () => {
    // Cursor restates the last incident hour: half the events are withdrawn.
    const lastHour = INCIDENT_START + (INCIDENT_HOURS - 1) * HOUR
    const revised = all.filter((e) => !(Number(e.timestamp) >= lastHour && e.conversationId === INCIDENT_CONVERSATION && Number(e.timestamp) % 60_000 !== 0))
    await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + 2 * HOUR), http: { fetch: cursorServing(revised) as never, ...fast } })
    const incident = (await facts(walletA)).filter((f) => f.sessionRef === INCIDENT_CONVERSATION)
    expect(incident.reduce((s, f) => s + f.costNanos, BigInt(0))).toBe(usd(130))
  })

  it("every pull is on the credential-use record, with the endpoint and who triggered it", async () => {
    const runs = await withTenant(walletA, (tx) => tx.usageSyncRun.findMany({ where: { walletId: walletA }, orderBy: { startedAt: "asc" } }))
    expect(runs.map((r) => [r.trigger, r.status, r.endpoint])).toEqual([
      ["connect_test", "ok", "/teams/filtered-usage-events"],
      ["cron", "ok", "/teams/filtered-usage-events"],
      ["cron", "ok", "/teams/filtered-usage-events"],
    ])
    expect(runs[0]).toMatchObject({ actorEmail: "admin@example.test", alertsRaised: 3 })
    expect(runs[0].httpCalls).toBeGreaterThanOrEqual(30)
    expect(runs[0].factsWritten).toBeGreaterThan(INCIDENT_HOURS)
  })

  it("RLS: usage data is invisible outside its tenant, even with no where clause", async () => {
    // No tenant scope at all: the app role sees nothing.
    expect(await db.usageFact.count()).toBe(0)
    expect(await db.usageAlert.count()).toBe(0)
    expect(await db.usageSyncRun.count()).toBe(0)
    // Scoped to B: A's rows do not exist, even when asked for by wallet id.
    await withTenant(walletB, async (tx) => {
      expect(await tx.usageFact.count()).toBe(0)
      expect(await tx.usageFact.count({ where: { walletId: walletA } })).toBe(0)
      expect(await tx.usageAlert.count({ where: { walletId: walletA } })).toBe(0)
      expect(await tx.usageSyncRun.count({ where: { connectionId: connectionA } })).toBe(0)
    })
    // B cannot write into A, or delete A's rows.
    const [sample] = await facts(walletA)
    const { id: _id, ...copy } = sample
    await expect(
      withTenant(walletB, (tx) => tx.usageFact.create({ data: { ...copy, dedupeKey: "forged" } })),
    ).rejects.toThrow()
    await withTenant(walletB, (tx) => tx.usageFact.deleteMany({ where: { walletId: walletA } }))
    expect((await facts(walletA)).length).toBeGreaterThan(0)
    // The read model for B shows none of A's money.
    const viewB = await aiSpendView(walletB, afterIncident)
    expect(viewB).toMatchObject({ hasData: false, monthToDate: BigInt(0), alerts: [] })
    expect(viewB.people).toEqual([])
  })

  it("the read model reports A's month, people and alerts", async () => {
    const view = await aiSpendView(walletA, afterIncident)
    expect(view.hasData).toBe(true)
    expect(view.monthToDate).toBeGreaterThan(usd(130))
    expect(view.people[0]).toMatchObject({ identity: "dev@example.test", topModel: "claude-4.5-sonnet" })
    expect(view.people[0].tools.map((t) => t[0])).toEqual(["cursor"])
    expect(view.alerts).toHaveLength(3)
    expect(view.connections[0]).toMatchObject({ provider: "cursor", keyIsOld: false })
    expect(view.days.reduce((s, d) => s + d.total, BigInt(0))).toBeGreaterThan(usd(130))
  })

  it("a rejected key marks the connection, stops the poller, and leaves stored data alone", async () => {
    const before = (await facts(walletA)).length
    const rejected = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    const result = await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + 3 * HOUR), http: { fetch: rejected as never, ...fast } })
    expect(result).toMatchObject({ ok: false, code: "bad_key" })
    expect((await facts(walletA)).length).toBe(before)
    const connection = await db.usageConnection.findUniqueOrThrow({ where: { id: connectionA } })
    expect(connection).toMatchObject({ status: "error", statusCode: "bad_key" })
    // The previous success is not overwritten by a failure.
    expect(connection.syncedThrough?.getTime()).toBe(afterIncident.getTime() + 2 * HOUR)
    const due = await dueConnections(1000)
    expect(due).not.toContain(connectionA)
    expect(due).toContain(connectionB)
    const last = await withTenant(walletA, (tx) => tx.usageSyncRun.findFirst({ where: { walletId: walletA }, orderBy: { startedAt: "desc" } }))
    expect(last).toMatchObject({ status: "failed", errorCode: "bad_key" })
  })

  it("keeps a newer completed sync when an older provider response arrives last", async () => {
    let signalStarted!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { signalStarted = resolve })
    const resume = new Promise<void>(resolve => { release = resolve })
    const staleResponse = cursorServing([])
    const delayedFetch = async (url: string, init: RequestInit) => {
      signalStarted()
      await resume
      return staleResponse(url, init)
    }
    const older = syncConnection(connectionB, {
      trigger: "cron", now: afterIncident, http: { fetch: delayedFetch as never, ...fast },
    })
    const newerTime = new Date(afterIncident.getTime() + HOUR)
    try {
      await Promise.race([started, older.then(() => { throw Error("Older sync never reached the provider") })])
      const newer = await syncConnection(connectionB, {
        trigger: "manual", now: newerTime, http: { fetch: cursorServing(all) as never, ...fast },
      })
      expect(newer.ok).toBe(true)
    } finally {
      release()
      await older
    }
    expect(await older).toMatchObject({ ok: false, code: "superseded" })
    const connection = await db.usageConnection.findUniqueOrThrow({ where: { id: connectionB } })
    expect(connection.syncedThrough).toEqual(newerTime)
    const incident = (await facts(walletB)).filter(f => f.sessionRef === INCIDENT_CONVERSATION)
    expect(incident.reduce((sum, f) => sum + f.costNanos, BigInt(0))).toBe(usd(140))
  })

  it("a connection whose vault row is gone fails closed without calling the provider", async () => {
    await withTenant(walletB, (tx) => tx.credentialVault.deleteMany({ where: { walletId: walletB } }))
    const fetchMock = vi.fn()
    const result = await syncConnection(connectionB, { trigger: "cron", http: { fetch: fetchMock as never, ...fast } })
    expect(result).toMatchObject({ ok: false, code: "missing_credential" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("Claude: joins usage and cost, stores Anthropic's refresh time, re-reads 8 days, and caps people not keys", async () => {
    const day = Date.UTC(2026, 10, 18)
    const refreshed = "2026-11-19T20:00:00Z"
    const actor = { dev: { type: "user_actor", user_id: "user_1", email_address: "Dev@Example.test" }, key: { type: "api_actor", api_key_id: "apikey_prod" } }
    const row = (hour: number, who: keyof typeof actor) => ({
      starting_at: new Date(day + hour * HOUR).toISOString(), ending_at: new Date(day + (hour + 1) * HOUR).toISOString(),
      group: { actor: actor[who], model: "claude-opus-5-5", product: who === "dev" ? "claude_code" : "messages_api" },
    })
    // Twelve hours each at $5.50: $66 for the day, per identity. Flat, so no rate spike.
    const usage = (["dev", "key"] as const).flatMap((who) => Array.from({ length: 12 }, (_, h) => ({
      ...row(h, who), usage: { uncached_input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, requests: 2 },
    })))
    const cost = (["dev", "key"] as const).flatMap((who) => Array.from({ length: 12 }, (_, h) => ({ ...row(h, who), cost: { amount: "550.000000", currency: "USD" } })))
    const calls: URL[] = []
    const anthropic = vi.fn(async (url: string) => {
      const u = new URL(url)
      calls.push(u)
      const from = Date.parse(u.searchParams.get("starting_at")!), to = Date.parse(u.searchParams.get("ending_at")!)
      const data = (u.pathname.endsWith("/usage") ? usage : cost).filter((r) => Date.parse(r.starting_at) >= from && Date.parse(r.starting_at) < to)
      return new Response(JSON.stringify({ data, data_refreshed_at: refreshed, has_more: false, next_page: null }))
    })
    const now = new Date(day + 36 * HOUR + 20 * 60_000)
    const first = await syncConnection(connectionC, { trigger: "connect_test", now, http: { fetch: anthropic as never, ...fast } })
    expect(first).toMatchObject({ ok: true, factsWritten: 24 })

    const stored = await facts(walletC)
    expect(stored).toHaveLength(24)
    expect(stored.reduce((s, f) => s + f.costNanos, BigInt(0))).toBe(usd(132))
    expect(stored.every((f) => f.provider === "anthropic" && f.sourceRefreshedAt.toISOString() === "2026-11-19T20:00:00.000Z")).toBe(true)
    expect(new Set(stored.map((f) => `${f.rawIdentity}:${f.identityType}:${f.surface}`))).toEqual(new Set(["dev@example.test:user:claude_code", "apikey_prod:api_key:api"]))

    // $66 in a day: an alert for the person, none for the production key.
    // The first hour also crosses the $5 floor with no history behind it.
    const alerts = await withTenant(walletC, (tx) => tx.usageAlert.findMany({ where: { walletId: walletC } }))
    expect(alerts.filter((a) => a.rule === "daily_cap").map((a) => a.subjectKey)).toEqual(["dev@example.test"])

    // Second pull: 8 days of overlap re-read, whole hours only, nothing changes.
    calls.length = 0
    const later = new Date(now.getTime() + HOUR)
    expect(await syncConnection(connectionC, { trigger: "cron", now: later, http: { fetch: anthropic as never, ...fast } })).toMatchObject({ ok: true, alertsRaised: 0 })
    expect(calls[0].searchParams.get("starting_at")).toBe(new Date(Math.floor((now.getTime() - 8 * 24 * HOUR) / HOUR) * HOUR).toISOString())
    expect(calls[0].searchParams.get("ending_at")).toBe(new Date(Math.floor(later.getTime() / HOUR) * HOUR).toISOString())
    const again = await facts(walletC)
    expect(again.map((f) => [f.dedupeKey, f.costNanos])).toEqual(stored.map((f) => [f.dedupeKey, f.costNanos]))

    const view = await aiSpendView(walletC, later)
    expect(view.connections[0]).toMatchObject({ provider: "anthropic", dataAsOf: new Date(refreshed) })
    const run = await withTenant(walletC, (tx) => tx.usageSyncRun.findFirst({ where: { walletId: walletC }, orderBy: { startedAt: "asc" } }))
    expect(run).toMatchObject({ endpoint: "/v1/organizations/analytics/usage + /v1/organizations/analytics/cost", httpCalls: 2 })
  })

  it("OpenAI: re-reads whole days, keeps billed totals exact, and replaces today's estimate once the day is priced", async () => {
    const d0 = Date.UTC(2026, 10, 18)
    const bucket = (start: number, span: number, results: unknown[]) => ({ start_time: start / 1000, end_time: (start + span) / 1000, results })
    const tokens = (input: number) => ({ input_tokens: input, output_tokens: 0, num_model_requests: 1, user_id: "user-a", api_key_id: null, model: "gpt-big" })
    // Yesterday: two hours, 3:1 by tokens. Today: one hour so far.
    const usage = [bucket(d0 + 9 * HOUR, HOUR, [tokens(3000)]), bucket(d0 + 15 * HOUR, HOUR, [tokens(1000)]), bucket(d0 + 26 * HOUR, HOUR, [tokens(2000)])]
    let costs = [bucket(d0, 24 * HOUR, [{ amount: { value: 8, currency: "usd" }, user_id: "user-a", api_key_id: null }])]
    const starts: number[] = []
    const openai = vi.fn(async (url: string) => {
      const u = new URL(url)
      const from = Number(u.searchParams.get("start_time")) * 1000, to = Number(u.searchParams.get("end_time")) * 1000
      if (u.pathname.endsWith("/completions")) starts.push(from)
      const data = (u.pathname.endsWith("/completions") ? usage : costs).filter((b) => b.start_time * 1000 >= from && b.start_time * 1000 < to)
      return new Response(JSON.stringify({ data, has_more: false, next_page: null }))
    })
    const cost = async () => Object.fromEntries((await facts(walletD)).map((f) => [f.bucketStart.toISOString().slice(5, 16), [f.costNanos, f.costBasis]]))

    const now = new Date(d0 + 27 * HOUR + 10 * 60_000)
    expect(await syncConnection(connectionD, { trigger: "connect_test", now, http: { fetch: openai as never, ...fast } })).toMatchObject({ ok: true, factsWritten: 3 })
    expect(await cost()).toEqual({
      "11-18T09:00": [usd(6), "allocated"],
      "11-18T15:00": [usd(2), "allocated"],
      // Not priced yet: 2,000 tokens at yesterday's $8 per 4,000.
      "11-19T02:00": [usd(4), "estimated"],
    })

    // An hour later OpenAI has priced today at $100. The pull asks from 72 hours
    // back, mid-day; the adapter widens that to midnight and the whole range
    // is replaced, so no stored row collides and the estimate becomes billed.
    costs = [...costs, bucket(d0 + 24 * HOUR, 24 * HOUR, [{ amount: { value: 100, currency: "usd" }, user_id: "user-a", api_key_id: null }])]
    starts.length = 0
    const later = new Date(now.getTime() + HOUR)
    expect(await syncConnection(connectionD, { trigger: "cron", now: later, http: { fetch: openai as never, ...fast } })).toMatchObject({ ok: true, factsWritten: 3 })
    expect(starts[0] % (24 * HOUR)).toBe(0)
    expect(starts[0]).toBe(Math.floor((now.getTime() - 72 * HOUR) / (24 * HOUR)) * 24 * HOUR)
    expect(await cost()).toEqual({
      "11-18T09:00": [usd(6), "allocated"],
      "11-18T15:00": [usd(2), "allocated"],
      "11-19T02:00": [usd(100), "allocated"],
    })

    const view = await aiSpendView(walletD, later)
    expect(view).toMatchObject({ monthToDate: usd(108), monthBilled: usd(108), monthEstimated: BigInt(0) })
    expect(view.alerts.map(a => a.rule)).toEqual(["daily_cap"])
  })
})
