import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "@/lib/db"
import { readSpendChartDays } from "@/lib/spendChartDays"

function token(agentId: string, time: string, costUsd: number) {
  return { agentId, createdAt: new Date(time), costUsd, model: "test", tokensIn: 1, tokensOut: 1 }
}

function request(agentId: string, localTime: string, amountUsd: number, status = "approved", decided = localTime) {
  return {
    agentId, createdAt: new Date(localTime), decidedAt: new Date(decided), amountUsd, status,
    action: "purchase", category: "testing", merchant: "fixture",
  }
}

function dayTotals(length: number, amounts: Record<number, number> = {}) {
  return Array.from({ length }, (_, i) => amounts[i + 1] ?? 0)
}

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("spend chart daily totals (Postgres)", () => {
  const wallet = randomUUID()
  const otherWallet = randomUUID()
  const active = randomUUID()
  const omitted = randomUUID()
  const idle = randomUUID()
  const foreign = randomUUID()
  const march11 = new Date("2026-03-11T12:00:00-05:00")

  beforeAll(async () => {
    // Exercise actual DST transitions even when CI runs in UTC.
    vi.stubEnv("TZ", "America/Chicago")
    for (const [id, agentIds] of [[wallet, [active, omitted, idle]], [otherWallet, [foreign]]] as const) {
      await db.wallet.create({ data: {
        id, name: "chart test", ownerEmail: `${id}@example.test`,
        agents: { create: agentIds.map(agentId => ({
          id: agentId, name: "chart seat", apiKeyHash: randomUUID(), apiKeyPrefix: "pxy_test",
        })) },
      } })
    }
    await db.tokenLog.createMany({ data: [
      token(active, "2026-02-25T23:59:59.999", 400),
      token(active, "2026-02-26T00:00:00", 1.25),
      token(active, "2026-02-28T23:59:59.999", 0.5),
      token(active, "2026-03-01T00:00:00", 2),
      token(active, "2026-03-08T00:00:00", 3),
      token(active, "2026-03-09T04:59:59.999Z", 0.75), // Last millisecond of March 8 in Chicago.
      token(active, "2026-03-09T05:00:00Z", 1),
      token(active, "2026-03-11T23:59:59.999", 4),
      token(active, "2026-03-31T23:59:59.999", 8),
      token(active, "2026-04-01T00:00:00", 500),
      token(omitted, "2026-03-01T12:00:00", 600),
      token(foreign, "2026-03-01T12:00:00", 700),
      token(active, "2026-10-31T23:59:59.999", 5),
      token(active, "2026-11-01T00:00:00", 6),
      token(active, "2026-11-02T05:59:59.999Z", 7), // Last millisecond of November 1 in Chicago.
      token(active, "2026-11-02T06:00:00Z", 8),
    ] })
    await db.authorizationRequest.createMany({ data: [
      request(active, "2026-02-28T23:59:59.999", 400, "approved", "2026-03-01T00:01:00"),
      request(active, "2026-03-01T00:00:00", 10, "approved", "2026-03-02T00:01:00"),
      request(active, "2026-03-02T23:59:59.999", 11),
      request(active, "2026-03-02T23:59:59.999", 0.5),
      request(active, "2026-03-08T12:00:00", 100, "denied"),
      request(active, "2026-03-09T12:00:00", 200, "escalated"),
      request(active, "2026-03-10T12:00:00", 300, "pending"),
      request(active, "2026-03-31T23:59:59.999", 12),
      request(active, "2026-04-01T00:00:00", 500),
      request(omitted, "2026-03-01T12:00:00", 600),
      request(foreign, "2026-03-01T12:00:00", 700),
      request(active, "2026-11-01T23:59:59.999", 14),
      request(active, "2026-11-02T00:00:00", 15),
    ] })
  })

  afterAll(() => vi.unstubAllEnvs())

  afterAll(async () => {
    const scope = { walletId: { in: [wallet, otherWallet] } }
    await db.$transaction([
      db.authorizationRequest.deleteMany({ where: { agent: scope } }),
      db.tokenLog.deleteMany({ where: { agent: scope } }),
      db.agent.deleteMany({ where: scope }),
      db.wallet.deleteMany({ where: { id: { in: [wallet, otherWallet] } } }),
    ])
  })

  it("uses the 14 local dates ending today and the whole month of approved spend by creation date", async () => {
    const chart = await readSpendChartDays([wallet], [active, foreign], march11)
    const labels = ["2/26", "2/27", "2/28", "3/1", "3/2", "3/3", "3/4", "3/5", "3/6", "3/7", "3/8", "3/9", "3/10", "3/11"]
    const costs = [1.25, 0, 0.5, 2, 0, 0, 0, 0, 0, 0, 3.75, 1, 0, 4]
    expect(chart.days).toEqual(labels.map((label, i) => ({ label, cost: costs[i] })))
    expect(chart.tokenByMonthDay).toEqual(dayTotals(31, { 1: 2, 8: 3.75, 9: 1, 11: 4, 31: 8 }))
    expect(chart.spendByMonthDay).toEqual(dayTotals(31, { 1: 10, 2: 11.5, 31: 12 }))
  })

  it("keeps early-month totals when the trend starts later and combines only the requested agents", async () => {
    const chart = await readSpendChartDays([wallet, otherWallet], [active, foreign], new Date(2026, 2, 30, 12))
    expect(chart.days.map(d => d.cost)).toEqual(dayTotals(14))
    expect(chart.tokenByMonthDay).toEqual(dayTotals(31, { 1: 702, 8: 3.75, 9: 1, 11: 4, 31: 8 }))
    expect(chart.spendByMonthDay).toEqual(dayTotals(31, { 1: 710, 2: 11.5, 31: 12 }))
  })

  it("keeps both ends of the fall-back day in one local bucket", async () => {
    const chart = await readSpendChartDays([wallet], [active], new Date(2026, 10, 3, 12))
    expect(chart.days.slice(-4)).toEqual([
      { label: "10/31", cost: 5 }, { label: "11/1", cost: 13 },
      { label: "11/2", cost: 8 }, { label: "11/3", cost: 0 },
    ])
    expect(chart.tokenByMonthDay).toEqual(dayTotals(30, { 1: 13, 2: 8 }))
    expect(chart.spendByMonthDay).toEqual(dayTotals(30, { 1: 14, 2: 15 }))
  })

  it("zero-fills an empty wallet scope, empty agent scope, or idle agent", async () => {
    for (const [walletIds, agentIds] of [[[], [active]], [[wallet], []], [[wallet], [idle]]]) {
      const chart = await readSpendChartDays(walletIds, agentIds, march11)
      expect(chart.days.map(d => d.cost)).toEqual(dayTotals(14))
      expect(chart.days[0].label).toBe("2/26")
      expect(chart.days[13].label).toBe("3/11")
      expect(chart.tokenByMonthDay).toEqual(dayTotals(31))
      expect(chart.spendByMonthDay).toEqual(dayTotals(31))
    }
  })
})
