import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "@/lib/db"
import { recentHighCursorDay } from "@/lib/homeCursorIncident"

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Home imported Cursor incident (Postgres)", () => {
  const wallets = [randomUUID(), randomUUID()]
  const now = new Date("2026-11-24T15:00:00Z")
  beforeAll(async () => {
    await db.wallet.createMany({ data: wallets.map(id => ({ id, name: "Home fixture", ownerEmail: id + "@example.test" })) })
    const item = {
      walletId: wallets[0], product: "cursor", usageType: "included", chargeCategory: "usage",
      cachedPromptTokens: 100_000_000,
    }
    await db.cursorBillingItem.createMany({ data: [
      { ...item, itemHash: "old", occurredAt: new Date("2026-10-25T23:59:59Z") },
      { ...item, itemHash: "early", occurredAt: new Date("2026-11-12T11:00:00Z") },
      { ...item, itemHash: "partial", occurredAt: new Date("2026-11-17T03:00:00Z"), cachedPromptTokens: 50_000_000 },
      { ...item, itemHash: "partial2", occurredAt: new Date("2026-11-17T20:00:00Z"), cachedPromptTokens: 50_000_000 },
      { ...item, itemHash: "quiet", occurredAt: new Date("2026-11-18T09:00:00Z"), cachedPromptTokens: 99 },
      { ...item, itemHash: "future", occurredAt: new Date("2026-11-24T15:00:01Z") },
      { ...item, walletId: wallets[1], itemHash: "other", occurredAt: new Date("2026-11-23T23:00:00Z") },
    ] })
  })
  afterAll(async () => { await db.wallet.deleteMany({ where: { id: { in: wallets } } }) })

  it("returns only the wallet's latest qualifying UTC day in the last 30 days, including cached tokens", async () => {
    expect(await recentHighCursorDay(wallets[0], now)).toEqual({
      day: "2026-11-17", items: BigInt(2), tokens: BigInt(100_000_000),
    })
    expect(await recentHighCursorDay(wallets[0], new Date("2027-01-01T00:00:00Z"))).toBeNull()
  })
})
