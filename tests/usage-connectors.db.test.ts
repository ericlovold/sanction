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
  const all = [...baselineEvents(), ...incidentEvents()] as Record<string, unknown>[]
  const afterIncident = new Date(INCIDENT_START + INCIDENT_HOURS * HOUR + 10 * 60_000)

  async function seed(name: string) {
    const wallet = await db.wallet.create({ data: { name, ownerEmail: `${crypto.randomUUID()}@example.test` } })
    const connection = await db.usageConnection.create({ data: { walletId: wallet.id, provider: "cursor", authKind: "admin_api_key" } })
    const label = usageVaultLabel("cursor", connection.id)
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
  })

  afterAll(async () => {
    if (!run) return
    for (const walletId of [walletA, walletB]) {
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
    const result = await syncConnection(connectionA, { trigger: "connect_test", actorEmail: "admin@example.test", now: afterIncident, cursor: { fetch: fetchMock as never, ...fast } })
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
    const result = await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + HOUR), cursor: { fetch: cursorServing(all) as never, ...fast } })
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
    await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + 2 * HOUR), cursor: { fetch: cursorServing(revised) as never, ...fast } })
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
    expect(view.people[0]).toMatchObject({ provider: "cursor", identity: "dev@example.test", topModel: "claude-4.5-sonnet" })
    expect(view.alerts).toHaveLength(3)
    expect(view.connections[0]).toMatchObject({ provider: "cursor", keyIsOld: false })
    expect(view.days.reduce((s, d) => s + d.total, BigInt(0))).toBeGreaterThan(usd(130))
  })

  it("a rejected key marks the connection, stops the poller, and leaves stored data alone", async () => {
    const before = (await facts(walletA)).length
    const rejected = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    const result = await syncConnection(connectionA, { trigger: "cron", now: new Date(afterIncident.getTime() + 3 * HOUR), cursor: { fetch: rejected as never, ...fast } })
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

  it("a connection whose vault row is gone fails closed without calling the provider", async () => {
    await withTenant(walletB, (tx) => tx.credentialVault.deleteMany({ where: { walletId: walletB } }))
    const fetchMock = vi.fn()
    const result = await syncConnection(connectionB, { trigger: "cron", cursor: { fetch: fetchMock as never, ...fast } })
    expect(result).toMatchObject({ ok: false, code: "missing_credential" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
