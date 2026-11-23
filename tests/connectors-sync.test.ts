// The sync shell with every dependency mocked: what it writes, in what order,
// and that no outcome escapes as a throw. tests/usage-connectors.db.test.ts
// proves the same path against real Postgres.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => {
  const tx = {
    credentialVault: { findFirst: vi.fn() },
    usageFact: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    usageAlert: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    usageSyncRun: { create: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(),
  }
  return {
    tx,
    db: {
      usageConnection: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      wallet: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
    decrypt: vi.fn(),
    email: vi.fn(),
    scope: vi.fn(),
  }
})
vi.mock("@/lib/db", () => ({ db: m.db }))
vi.mock("@/lib/rls", () => ({ withTenant: (_w: string, fn: (tx: unknown) => unknown) => fn(m.tx), scopeTenant: m.scope }))
vi.mock("@/lib/credentialCrypto", () => ({ decryptCredentialEnvelope: m.decrypt }))
vi.mock("@/lib/email", () => ({ sendUsageAlertEmail: m.email }))

import { dueConnections, syncConnection } from "../lib/connectors/sync"
import { aiSpendView, connectionHealth, forecastMonthEnd } from "../lib/connectors/spendView"
import { usd } from "../lib/connectors/money"
import { GET } from "../app/api/cron/usage-sync/route"
import { INCIDENT_HOURS, INCIDENT_START, incidentEvents } from "./helpers/cursor-incident"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = new Date(INCIDENT_START + INCIDENT_HOURS * HOUR)
const fast = { sleep: async () => {}, take: async () => {} }
const connection = {
  id: "conn_1", walletId: "w_1", provider: "cursor", status: "active", statusCode: null,
  credentialId: "cred_1", syncedThrough: new Date(now.getTime() - HOUR), connectedAt: new Date(now.getTime() - 5 * DAY),
  connectedByEmail: "admin@example.test", lastSuccessAt: new Date(now.getTime() - HOUR), lastAttemptAt: null, statusDetail: null,
}

function serving(events: unknown[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { startDate, endDate } = JSON.parse(init.body as string)
    const usageEvents = (events as { timestamp: string }[]).filter((e) => Number(e.timestamp) >= startDate && Number(e.timestamp) <= endDate)
    return new Response(JSON.stringify({ totalUsageEventsCount: usageEvents.length, pagination: { hasNextPage: false }, usageEvents }))
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  m.db.usageConnection.findUnique.mockResolvedValue(connection)
  m.db.usageConnection.update.mockResolvedValue({})
  m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.tx))
  m.db.wallet.findUnique.mockResolvedValue({ ownerEmail: "owner@example.test", name: "Acme" })
  m.tx.credentialVault.findFirst.mockResolvedValue({ id: "cred_1", walletId: "w_1", label: "usage:cursor:conn_1", encryptedValue: "x", keyId: "k" })
  m.decrypt.mockResolvedValue("crsr_plaintext_key")
  m.tx.usageAlert.findMany.mockResolvedValue([])
  m.tx.usageSyncRun.create.mockResolvedValue({})
  // The guardrails read back what was just written.
  m.tx.usageFact.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => {
    m.tx.usageFact.findMany.mockResolvedValue(data)
    return { count: data.length }
  })
  m.tx.usageFact.findMany.mockResolvedValue([])
})

describe("syncConnection", () => {
  it("re-reads a trailing overlap, replaces the window atomically, then records and notifies", async () => {
    const fetchMock = serving(incidentEvents())
    const result = await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: fetchMock as never, ...fast } })
    expect(result).toMatchObject({ ok: true, factsWritten: INCIDENT_HOURS, alertsRaised: 3 })

    // 48 hours back from the last pull, aligned to the hour.
    const windowStart = new Date(Math.floor((connection.syncedThrough.getTime() - 48 * HOUR) / HOUR) * HOUR)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).startDate).toBe(windowStart.getTime())
    expect(m.scope).toHaveBeenCalledWith(m.tx, "w_1")
    expect(m.tx.$executeRaw).toHaveBeenCalledOnce() // per-connection advisory lock
    expect(m.tx.usageFact.deleteMany).toHaveBeenCalledWith({ where: { walletId: "w_1", connectionId: "conn_1", bucketStart: { gte: windowStart } } })
    expect(m.tx.usageFact.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(m.tx.usageFact.createMany.mock.invocationCallOrder[0])
    const written = m.tx.usageFact.createMany.mock.calls[0][0].data
    expect(written.every((f: { walletId: string; connectionId: string; dedupeKey: string; sourceRefreshedAt: Date }) =>
      f.walletId === "w_1" && f.connectionId === "conn_1" && /^[0-9a-f]{64}$/.test(f.dedupeKey) && f.sourceRefreshedAt === now)).toBe(true)
    expect(written.reduce((s: bigint, f: { costNanos: bigint }) => s + f.costNanos, BigInt(0))).toBe(usd(140))

    expect(m.db.usageConnection.update).toHaveBeenCalledWith({
      where: { id: "conn_1" },
      data: { status: "active", statusCode: null, statusDetail: null, lastAttemptAt: now, lastSuccessAt: now, syncedThrough: now },
    })
    expect(m.tx.usageSyncRun.create.mock.calls[0][0].data).toMatchObject({
      walletId: "w_1", connectionId: "conn_1", trigger: "cron", actorEmail: null, endpoint: "/teams/filtered-usage-events",
      status: "ok", factsWritten: INCIDENT_HOURS, alertsRaised: 3,
    })
    expect(m.email).toHaveBeenCalledExactlyOnceWith("owner@example.test", expect.objectContaining({ walletName: "Acme" }))
    expect(m.tx.usageAlert.updateMany).toHaveBeenCalledOnce()
  })

  it("the decrypted key goes to the provider and nowhere else", async () => {
    const fetchMock = serving([])
    await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: fetchMock as never, ...fast } })
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("crsr_plaintext_key:").toString("base64")}`)
    const persisted = JSON.stringify([m.db.usageConnection.update.mock.calls, m.tx.usageSyncRun.create.mock.calls, (console.error as never as { mock: { calls: unknown[] } }).mock.calls])
    expect(persisted).not.toContain("crsr_plaintext_key")
  })

  it("a first pull reads 30 days", async () => {
    m.db.usageConnection.findUnique.mockResolvedValue({ ...connection, syncedThrough: null })
    const fetchMock = serving([])
    await syncConnection("conn_1", { trigger: "connect_test", actorEmail: "a@example.test", now, cursor: { fetch: fetchMock as never, ...fast } })
    expect(fetchMock).toHaveBeenCalledTimes(30)
    expect(m.tx.usageSyncRun.create.mock.calls[0][0].data).toMatchObject({ trigger: "connect_test", actorEmail: "a@example.test", httpCalls: 30 })
    expect(m.tx.usageFact.createMany).not.toHaveBeenCalled()
  })

  it("alerts already on record are not raised or emailed again", async () => {
    m.tx.usageAlert.findMany.mockImplementation(async ({ where }: { where: { dedupeKey: { in: string[] } } }) => where.dedupeKey.in.map((dedupeKey) => ({ dedupeKey })))
    const result = await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: serving(incidentEvents()) as never, ...fast } })
    expect(result).toMatchObject({ ok: true, alertsRaised: 0 })
    expect(m.tx.usageAlert.createMany).not.toHaveBeenCalled()
    expect(m.email).not.toHaveBeenCalled()
  })

  it("alerts found in old history are recorded but not emailed", async () => {
    m.db.usageConnection.findUnique.mockResolvedValue({ ...connection, syncedThrough: null })
    const later = new Date(now.getTime() + 5 * DAY)
    const result = await syncConnection("conn_1", { trigger: "connect_test", now: later, cursor: { fetch: serving(incidentEvents()) as never, ...fast } })
    expect(result).toMatchObject({ ok: true, alertsRaised: 3 })
    expect(m.tx.usageAlert.createMany).toHaveBeenCalledOnce()
    expect(m.email).not.toHaveBeenCalled()
  })

  it("a failed email does not fail a pull whose data is stored", async () => {
    m.email.mockRejectedValue(new Error("resend down"))
    const result = await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: serving(incidentEvents()) as never, ...fast } })
    expect(result.ok).toBe(true)
    expect(m.tx.usageAlert.updateMany).not.toHaveBeenCalled()
    m.email.mockResolvedValue(undefined)
    m.db.wallet.findUnique.mockResolvedValue(null)
    expect((await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: serving(incidentEvents()) as never, ...fast } })).ok).toBe(true)
  })

  it("a provider failure is recorded on the connection and the run, and returned, never thrown", async () => {
    const rejected = vi.fn(async () => new Response("{}", { status: 401 }))
    const result = await syncConnection("conn_1", { trigger: "manual", actorEmail: "a@example.test", now, cursor: { fetch: rejected as never, ...fast } })
    expect(result).toMatchObject({ ok: false, code: "bad_key" })
    expect(m.db.$transaction).not.toHaveBeenCalled()
    expect(m.db.usageConnection.update.mock.calls[0][0].data).toMatchObject({ status: "error", statusCode: "bad_key", lastAttemptAt: now })
    expect(m.db.usageConnection.update.mock.calls[0][0].data).not.toHaveProperty("syncedThrough")
    expect(m.tx.usageSyncRun.create.mock.calls[0][0].data).toMatchObject({ status: "failed", errorCode: "bad_key", trigger: "manual", httpCalls: 0 })
  })

  it("an unexpected crash is contained too, with a generic message", async () => {
    m.db.$transaction.mockRejectedValue(new Error("connection reset: postgres://user:pw@host"))
    m.db.usageConnection.update.mockRejectedValue(new Error("still down"))
    m.tx.usageSyncRun.create.mockRejectedValue(new Error("still down"))
    const result = await syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: serving([]) as never, ...fast } })
    expect(result).toMatchObject({ ok: false, code: "provider_unavailable" })
    expect(JSON.stringify(result)).not.toContain("postgres://")
  })

  it("refuses without calling the provider: no connection, disconnected, unknown provider, no credential", async () => {
    const fetchMock = vi.fn()
    const attempt = () => syncConnection("conn_1", { trigger: "cron", now, cursor: { fetch: fetchMock as never, ...fast } })
    m.db.usageConnection.findUnique.mockResolvedValue(null)
    expect(await attempt()).toMatchObject({ ok: false, code: "missing_credential" })
    m.db.usageConnection.findUnique.mockResolvedValue({ ...connection, status: "disconnected" })
    expect(await attempt()).toMatchObject({ ok: false, code: "missing_credential" })
    m.db.usageConnection.findUnique.mockResolvedValue({ ...connection, provider: "unknown" })
    expect(await attempt()).toMatchObject({ ok: false, code: "unexpected_response" })
    m.db.usageConnection.findUnique.mockResolvedValue({ ...connection, credentialId: null })
    expect(await attempt()).toMatchObject({ ok: false, code: "missing_credential" })
    m.db.usageConnection.findUnique.mockResolvedValue(connection)
    m.tx.credentialVault.findFirst.mockResolvedValue(null)
    expect(await attempt()).toMatchObject({ ok: false, code: "missing_credential" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.decrypt).not.toHaveBeenCalled()
  })
})

describe("dueConnections", () => {
  it("skips connections that need a human, keeps transient failures", async () => {
    m.db.usageConnection.findMany.mockResolvedValue([
      { id: "ok", statusCode: null }, { id: "dead", statusCode: "bad_key" }, { id: "plan", statusCode: "plan_unsupported" }, { id: "flaky", statusCode: "rate_limited" },
    ])
    expect(await dueConnections()).toEqual(["ok", "flaky"])
    expect(m.db.usageConnection.findMany.mock.calls[0][0].where).toEqual({ status: { in: ["active", "error"] }, credentialId: { not: null } })
  })
})

describe("GET /api/cron/usage-sync", () => {
  const request = (authorization?: string) => new NextRequest("https://test.local/api/cron/usage-sync", { headers: authorization ? { authorization } : {} })

  it("fails closed: no secret configured, no header, wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(request("Bearer "))).status).toBe(401)
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request("Bearer wrong"))).status).toBe(401)
    expect(m.db.usageConnection.findMany).not.toHaveBeenCalled()
  })

  it("pulls each due connection and reports counts without failing the cron on one bad key", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })))
    m.db.usageConnection.findMany.mockResolvedValue([{ id: "conn_1", statusCode: null }, { id: "gone", statusCode: null }])
    m.db.usageConnection.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "conn_1" ? connection : null))
    const res = await GET(request("Bearer cron-test-secret"))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ connections: 2, synced: 0, failed: 2, deferred: 0 })
    vi.unstubAllGlobals()
  })
})

describe("read model", () => {
  it("forecast is a straight-line run rate, and refuses to guess in the first three days", () => {
    expect(forecastMonthEnd(usd(100), new Date(Date.UTC(2026, 10, 2, 12)))).toBeNull()
    // Nov has 30 days; $100 by the end of day 10 projects to $300.
    expect(forecastMonthEnd(usd(100), new Date(Date.UTC(2026, 10, 11)))).toBe(usd(300))
    expect(forecastMonthEnd(BigInt(0), new Date(Date.UTC(2026, 10, 20)))).toBe(BigInt(0))
  })

  it("connection health: stale after twice the expected freshness", () => {
    const at = (c: Partial<typeof connection>, agoMs: number | null) =>
      connectionHealth({ status: "active", statusCode: null, lastSuccessAt: agoMs === null ? null : new Date(now.getTime() - agoMs), ...c }, HOUR, now)
    expect(at({}, 30 * 60_000)).toBe("ok")
    expect(at({}, 2 * HOUR)).toBe("ok")
    expect(at({}, 2 * HOUR + 1)).toBe("stale")
    expect(at({ status: "error", statusCode: "rate_limited" as never }, 3 * HOUR)).toBe("failing")
    expect(at({}, null)).toBe("waiting")
    expect(at({ status: "error", statusCode: "provider_unavailable" as never }, null)).toBe("failing")
    expect(at({ status: "error", statusCode: "bad_key" as never }, 60_000)).toBe("reconnect")
  })

  it("folds facts into month, days, people and models", async () => {
    const at = new Date(Date.UTC(2026, 10, 20, 12))
    m.db.usageConnection.findMany.mockResolvedValue([{ ...connection, connectedAt: new Date(Date.UTC(2026, 7, 1)), lastSuccessAt: at }])
    m.tx.usageFact.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by.includes("bucketStart")
        ? [
            { bucketStart: new Date(Date.UTC(2026, 10, 19, 3)), provider: "cursor", costBasis: "billed", _sum: { costNanos: usd(40) } },
            { bucketStart: new Date(Date.UTC(2026, 10, 19, 4)), provider: "cursor", costBasis: "included", _sum: { costNanos: usd(10) } },
            { bucketStart: new Date(Date.UTC(2026, 9, 28, 4)), provider: "cursor", costBasis: "billed", _sum: { costNanos: usd(7) } },
            { bucketStart: new Date(Date.UTC(2026, 9, 2, 4)), provider: "cursor", costBasis: "billed", _sum: { costNanos: usd(3) } },
          ]
        : [
            { provider: "cursor", rawIdentity: "a@x.test", identityType: "user", model: "big", costBasis: "billed", _sum: { costNanos: usd(30), inputTokens: BigInt(10), outputTokens: BigInt(5), cacheReadTokens: BigInt(1), cacheWriteTokens: BigInt(1), requests: 4 } },
            { provider: "cursor", rawIdentity: "a@x.test", identityType: "user", model: "small", costBasis: "included", _sum: { costNanos: usd(10), inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, requests: null } },
            { provider: "cursor", rawIdentity: "bot@x.test", identityType: "service_account", model: "big", costBasis: "billed", _sum: { costNanos: usd(10), inputTokens: BigInt(1), outputTokens: BigInt(1), cacheReadTokens: BigInt(0), cacheWriteTokens: BigInt(0), requests: 1 } },
          ],
    )
    m.tx.usageAlert.findMany.mockResolvedValue([{ id: "al_1", evidence: { identity: "a@x.test", billedNanos: "1", top: [] } }])
    m.tx.usageSyncRun.findMany.mockResolvedValue([{ connectionId: "conn_1", status: "ok" }])

    const view = await aiSpendView("w_1", at)
    expect(view).toMatchObject({ hasData: true, monthToDate: usd(50), monthBilled: usd(40), lastMonth: usd(10), lastMonthPartial: false })
    expect(view.monthByProvider).toEqual([["cursor", usd(50)]])
    expect(view.days).toHaveLength(30)
    expect(view.days.reduce((s, d) => s + d.total, BigInt(0))).toBe(usd(57)) // Oct 2 is outside the 30-day chart
    expect(view.days[view.days.length - 2].byProvider.get("cursor")).toBe(usd(50))
    expect(view.people.map((p) => [p.identity, p.cost, p.billed, p.topModel, p.tokens, p.requests])).toEqual([
      ["a@x.test", usd(40), usd(30), "big", BigInt(17), 4],
      ["bot@x.test", usd(10), usd(10), "big", BigInt(2), 1],
    ])
    expect(view.models).toEqual([{ provider: "cursor", model: "big", cost: usd(40) }, { provider: "cursor", model: "small", cost: usd(10) }])
    expect(view.connections[0]).toMatchObject({ health: "ok", keyIsOld: true, lastRun: { status: "ok" } })
    expect(view.alerts[0].evidence.identity).toBe("a@x.test")
  })

  it("an empty wallet is all zeros, and last month is flagged partial for a fresh connection", async () => {
    m.db.usageConnection.findMany.mockResolvedValue([{ ...connection, provider: "future-tool", connectedAt: now }])
    m.tx.usageFact.groupBy.mockResolvedValue([])
    m.tx.usageAlert.findMany.mockResolvedValue([])
    m.tx.usageSyncRun.findMany.mockResolvedValue([])
    const view = await aiSpendView("w_1", now)
    expect(view).toMatchObject({ hasData: false, monthToDate: BigInt(0), lastMonthPartial: true, people: [], models: [] })
    expect(view.connections[0].lastRun).toBeNull()
  })
})
