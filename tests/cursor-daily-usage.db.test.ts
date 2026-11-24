import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { getDailyUsage } from "@/app/dashboard/usage/cursor/daily-usage"
import { db } from "@/lib/db"

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("Cursor daily usage (Postgres)", () => {
  const walletId = randomUUID()
  const otherWalletId = randomUUID()

  beforeAll(async () => {
    await db.wallet.createMany({ data: [walletId, otherWalletId].map(id => ({
      id, name: "Cursor usage fixture", ownerEmail: `${id}@example.test`,
    })) })
    const item = {
      walletId, product: "cursor", usageType: "on_demand", chargeCategory: "usage",
      occurredAt: new Date("2026-10-01T19:00:00-05:00"), // Midnight UTC on October 2.
      model: "model-a", promptTokens: 10, completionTokens: 2, cachedPromptTokens: 5, cacheWriteTokens: 1,
    }
    await db.cursorBillingItem.createMany({ data: [
      { ...item, itemHash: "before", occurredAt: new Date("2026-10-01T23:59:59.999Z") },
      { ...item, itemHash: "midnight" },
      { ...item, itemHash: "missing-cache", cachedPromptTokens: null },
      { ...item, itemHash: "zero", model: "model-b", promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, cacheWriteTokens: 0 },
      { ...item, itemHash: "missing", model: null, promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null },
      { ...item, itemHash: "midnight", walletId: otherWalletId, cachedPromptTokens: 999 },
    ] })
  })

  afterAll(async () => {
    await db.wallet.deleteMany({ where: { id: { in: [walletId, otherWalletId] } } })
  })

  it("groups only the requested wallet by UTC date and model, preserving zero and missing counts", async () => {
    const days = await getDailyUsage(walletId)
    const one = BigInt(1)
    const zero = BigInt(0)
    const before = {
      day: "2026-10-01", items: one, tokens: BigInt(18), cached: BigInt(5), cachedPartial: false, partial: false,
    }
    expect(days).toEqual([
      {
        day: "2026-10-02", items: BigInt(4), tokens: BigInt(31), cached: BigInt(5), partial: true, cachedPartial: true,
        models: [
          { day: "2026-10-02", model: "model-a", items: BigInt(2), tokens: BigInt(31), cached: BigInt(5), partial: true, cachedPartial: true },
          { day: "2026-10-02", model: "model-b", items: one, tokens: zero, cached: zero, partial: false, cachedPartial: false },
          { day: "2026-10-02", model: null, items: one, tokens: null, cached: null, partial: true, cachedPartial: true },
        ],
      },
      { ...before, models: [{ ...before, model: "model-a" }] },
    ])
  })
})
