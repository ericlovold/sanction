import { describe, expect, it } from "vitest"
import { crossedThreshold, dailyPace, bucketByDay, cumulative } from "../lib/burn"

describe("crossedThreshold", () => {
  // Default line: 80% of cap.
  it("fires exactly on the charge that crosses the line", () => {
    expect(crossedThreshold(3900, 4100, 5000)).toBe(true) // 78% → 82%
    expect(crossedThreshold(3999, 4000, 5000)).toBe(true) // lands exactly on 80%
  })

  it("does not fire below, or again after, the line", () => {
    expect(crossedThreshold(1000, 2000, 5000)).toBe(false) // still under
    expect(crossedThreshold(4100, 4300, 5000)).toBe(false) // already past — fired earlier
    expect(crossedThreshold(4000, 4500, 5000)).toBe(false) // prev exactly at the line
  })

  it("never fires without a positive cap", () => {
    expect(crossedThreshold(0, 10_000, null)).toBe(false)
    expect(crossedThreshold(0, 10_000, 0)).toBe(false)
  })

  it("supports a custom percentage", () => {
    expect(crossedThreshold(400, 600, 1000, 50)).toBe(true)
    expect(crossedThreshold(600, 700, 1000, 50)).toBe(false)
  })
})

describe("dailyPace", () => {
  const noon = new Date("2026-07-01T12:00:00")
  const earlyMorning = new Date("2026-07-01T00:10:00")

  it("projects linearly from the elapsed fraction of the day", () => {
    const p = dailyPace(25, 100, noon) // $25 by noon → $50 by midnight
    expect(p.onPace).toBeCloseTo(50, 5)
    expect(p.willExhaust).toBe(false)
    expect(p.exhaustAt).toBeNull()
    expect(p.pctOfCap).toBeCloseTo(25, 5)
  })

  it("predicts the cap hit time when the pace overruns", () => {
    const p = dailyPace(75, 100, noon) // on pace for $150 → cap at 16:00
    expect(p.onPace).toBeCloseTo(150, 5)
    expect(p.willExhaust).toBe(true)
    expect(p.exhaustAt?.getHours()).toBe(16)
  })

  it("does not extrapolate the first minutes of the day", () => {
    const p = dailyPace(5, 100, earlyMorning)
    expect(p.onPace).toBeNull()
    expect(p.willExhaust).toBe(false)
  })

  it("handles uncapped and zero-spend states", () => {
    expect(dailyPace(25, null, noon).willExhaust).toBe(false)
    expect(dailyPace(25, null, noon).pctOfCap).toBeNull()
    expect(dailyPace(0, 100, noon).onPace).toBeNull()
  })

  it("already at/over cap does not project an exhaust time", () => {
    const p = dailyPace(100, 100, noon)
    expect(p.willExhaust).toBe(false) // exhausted is the enforcement layer's message, not a forecast
    expect(p.pctOfCap).toBeCloseTo(100, 5)
  })
})

describe("bucketByDay", () => {
  const start = new Date("2026-08-01T09:30:00") // time-of-day must be ignored

  it("buckets amounts into local-day slots and drops out-of-window events", () => {
    const totals = bucketByDay(
      [
        { at: new Date("2026-08-01T00:05:00"), amount: 3 },
        { at: new Date("2026-08-01T23:55:00"), amount: 2 },
        { at: new Date("2026-08-03T12:00:00"), amount: 7 },
        { at: new Date("2026-07-31T23:59:00"), amount: 100 }, // before window
        { at: new Date("2026-08-05T00:00:00"), amount: 100 }, // after window
      ],
      start,
      4,
    )
    expect(totals).toEqual([5, 0, 7, 0])
  })

  it("returns all zeros for no events", () => {
    expect(bucketByDay([], start, 3)).toEqual([0, 0, 0])
  })

  it("cumulative is a running total", () => {
    expect(cumulative([3, 1, 4])).toEqual([3, 4, 8])
    expect(cumulative([])).toEqual([])
  })
})
