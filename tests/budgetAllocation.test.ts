import { describe, expect, it } from "vitest"

import { allocatePoolCaps, parseAllocationStrategy, type AllocationChildInput } from "../lib/budgetAllocation"

const child = (
  id: string,
  spendTodayCents: number,
  delegatedDailyCents: number,
): AllocationChildInput => ({
  id,
  name: id,
  spendTodayCents,
  delegatedDailyCents,
})

function caps(results: ReturnType<typeof allocatePoolCaps>) {
  return Object.fromEntries(results.map((row) => [row.id, row.capCents]))
}

describe("allocatePoolCaps", () => {
  it("splits a parent cap equally and keeps rounding inside the parent cap", () => {
    const results = allocatePoolCaps(100, [child("a", 0, 0), child("b", 0, 0), child("c", 0, 0)], "equal")

    expect(results.reduce((sum, row) => sum + row.capCents, 0)).toBe(100)
    expect(caps(results)).toEqual({ a: 34, b: 33, c: 33 })
  })

  it("weights allocation by current spend", () => {
    expect(caps(allocatePoolCaps(10_000, [
      child("research", 7_500, 9_000),
      child("support", 2_500, 9_000),
    ], "spend"))).toEqual({
      research: 7_500,
      support: 2_500,
    })
  })

  it("weights allocation by delegated authority", () => {
    expect(caps(allocatePoolCaps(10_000, [
      child("research", 500, 8_000),
      child("support", 500, 2_000),
    ], "delegated"))).toEqual({
      research: 8_000,
      support: 2_000,
    })
  })

  it("weights allocation by remaining delegated headroom and falls back to equal when all weights are zero", () => {
    expect(caps(allocatePoolCaps(10_000, [
      child("research", 1_000, 9_000),
      child("support", 1_000, 3_000),
    ], "headroom"))).toEqual({
      research: 8_000,
      support: 2_000,
    })

    expect(caps(allocatePoolCaps(99, [
      child("research", 9_000, 1_000),
      child("support", 3_000, 1_000),
    ], "headroom"))).toEqual({
      research: 50,
      support: 49,
    })
  })
})

describe("parseAllocationStrategy", () => {
  it("accepts known strategies and defaults unknown values to headroom", () => {
    expect(parseAllocationStrategy("equal")).toBe("equal")
    expect(parseAllocationStrategy("spend")).toBe("spend")
    expect(parseAllocationStrategy("delegated")).toBe("delegated")
    expect(parseAllocationStrategy("headroom")).toBe("headroom")
    expect(parseAllocationStrategy("surprise")).toBe("headroom")
    expect(parseAllocationStrategy(null)).toBe("headroom")
  })
})
