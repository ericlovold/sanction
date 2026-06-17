import { describe, it, expect } from "vitest"
import { dayRangeUtc, authEventType, mergeEvents } from "../lib/reporting"

describe("dayRangeUtc", () => {
  it("returns a 24h UTC window", () => {
    const { start, end } = dayRangeUtc("2026-06-17")
    expect(start.toISOString()).toBe("2026-06-17T00:00:00.000Z")
    expect(end.toISOString()).toBe("2026-06-18T00:00:00.000Z")
  })
  it("rejects malformed dates", () => {
    expect(() => dayRangeUtc("2026-6-1")).toThrow()
    expect(() => dayRangeUtc("nope")).toThrow()
    expect(() => dayRangeUtc("2026-13-40")).toThrow()
  })
})

describe("authEventType", () => {
  it("maps known statuses", () => {
    expect(authEventType("approved")).toBe("authorization.approved")
    expect(authEventType("escalated")).toBe("authorization.escalated")
    expect(authEventType("denied")).toBe("authorization.denied")
  })
  it("falls through for unknown statuses", () => {
    expect(authEventType("weird")).toBe("authorization.weird")
  })
})

describe("mergeEvents", () => {
  it("merges desc by `at` and caps at limit", () => {
    const a = [{ at: "2026-06-17T03:00:00Z", k: "a1" }, { at: "2026-06-17T01:00:00Z", k: "a2" }]
    const b = [{ at: "2026-06-17T02:00:00Z", k: "b1" }]
    expect(mergeEvents([a, b], 2).map((e) => e.k)).toEqual(["a1", "b1"])
    expect(mergeEvents([a, b], 10).map((e) => e.k)).toEqual(["a1", "b1", "a2"])
  })
})
