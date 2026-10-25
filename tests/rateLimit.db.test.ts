import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "../lib/db"
import { rateLimit } from "../lib/rateLimit"

// Run only against a disposable database. vitest globalSetup supplies the
// restricted app role; fixtures and cleanup touch only this test's exact keys.
const run = process.env.RUN_DB_TESTS === "1"
const now = new Date("2030-01-01T00:00:00.000Z")
const windowSeconds = 60
const limit = 12
const attempts = 40

describe.skipIf(!run)("distributed rate limiter (Postgres)", () => {
  let bucket: string
  let keys: string[]

  beforeEach(() => {
    bucket = `rate-limit-test-${randomUUID()}`
    keys = []
    // Only Date is faked: pg connection timers and scheduling remain real.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (keys.length) await db.rateLimit.deleteMany({ where: { key: { in: keys } } })
  })

  function fixture(ip = "192.0.2.1", selectedBucket = bucket) {
    const key = `${selectedBucket}:${ip}`
    keys.push(key)
    return { key, call: () => rateLimit(selectedBucket, ip, limit, windowSeconds) }
  }

  it.each(["missing", "expired", "active"] as const)(
    "counts every concurrent request against a %s row",
    async (state) => {
      const { key, call } = fixture()
      const initialCount = state === "active" ? 3 : 0
      const activeEnd = new Date(now.getTime() + 45_000)
      if (state !== "missing") {
        await db.rateLimit.create({ data: {
          key,
          count: state === "expired" ? 99 : initialCount,
          windowEnd: state === "expired" ? new Date(now.getTime() - 1) : activeEnd,
        } })
      }

      // Settle every request before asserting or cleaning up, including failures.
      const settled = await Promise.allSettled(Array.from({ length: attempts }, call))
      expect(settled.filter((result) => result.status === "rejected")).toEqual([])
      const results = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
      expect(results.filter((result) => result.ok)).toHaveLength(limit - initialCount)
      expect(results.filter((result) => !result.ok)).toHaveLength(attempts - limit + initialCount)
      for (const result of results) {
        expect(result.limit).toBe(limit)
        if (!result.ok) expect(result.retryAfter).toBe(state === "active" ? 45 : 60)
      }
      const stored = await db.rateLimit.findUniqueOrThrow({ where: { key } })
      expect(stored.count).toBe(attempts + initialCount)
      expect(stored.windowEnd).toEqual(state === "active" ? activeEnd : new Date(now.getTime() + 60_000))
    },
  )

  it("resets exactly at expiry and preserves the new expiry on subsequent requests", async () => {
    const { key, call } = fixture()
    await db.rateLimit.create({ data: { key, count: limit, windowEnd: now } })
    expect(await call()).toEqual({ ok: true, limit })
    const nextEnd = new Date(now.getTime() + 60_000)
    expect(await db.rateLimit.findUniqueOrThrow({ where: { key } })).toMatchObject({ count: 1, windowEnd: nextEnd })

    vi.setSystemTime(new Date(now.getTime() + 10_000))
    expect(await call()).toEqual({ ok: true, limit })
    expect(await db.rateLimit.findUniqueOrThrow({ where: { key } })).toMatchObject({ count: 2, windowEnd: nextEnd })
  })

  it("isolates different IPs and buckets while retaining the exhausted counter", async () => {
    const exhausted = fixture()
    const otherIp = fixture("192.0.2.2")
    const otherBucket = fixture("192.0.2.1", `${bucket}-other`)
    await db.rateLimit.create({ data: {
      key: exhausted.key, count: limit, windowEnd: new Date(now.getTime() + 60_000),
    } })
    expect(await exhausted.call()).toEqual({ ok: false, retryAfter: 60, limit })
    expect(await otherIp.call()).toEqual({ ok: true, limit })
    expect(await otherBucket.call()).toEqual({ ok: true, limit })
    const rows = await db.rateLimit.findMany({ where: { key: { in: keys } } })
    expect(new Map(rows.map((row) => [row.key, row.count]))).toEqual(new Map([
      [exhausted.key, limit + 1], [otherIp.key, 1], [otherBucket.key, 1],
    ]))
  })
})
