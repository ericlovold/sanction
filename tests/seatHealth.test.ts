import { describe, expect, it } from "vitest"
import { seatHealth, type SeatHealthInput } from "../lib/seatHealth"

const seat = (over: Partial<SeatHealthInput>): SeatHealthInput => ({
  id: "a1",
  name: "ops_agent",
  month: { approved: 0, denied: 0, escalated: 0 },
  recent: { approved: 0, denied: 0, escalated: 0 },
  ...over,
})

describe("seatHealth", () => {
  it("flags a hot seat: denial rate ≥ 25% over a real sample", () => {
    const flags = seatHealth([seat({ month: { approved: 6, denied: 3, escalated: 1 } })])
    expect(flags).toHaveLength(1)
    expect(flags[0].hot).toBe(true)
    expect(flags[0].denialRateMonth).toBeCloseTo(0.3)
  })

  it("ignores small samples — 2 denials out of 3 decisions is noise", () => {
    expect(seatHealth([seat({ month: { approved: 1, denied: 2, escalated: 0 } })])).toEqual([])
  })

  it("flags a climbing seat even when the month baseline is healthy", () => {
    const flags = seatHealth([
      seat({
        month: { approved: 90, denied: 10, escalated: 0 }, // 10% baseline
        recent: { approved: 6, denied: 4, escalated: 0 }, // 40% recent
      }),
    ])
    expect(flags).toHaveLength(1)
    expect(flags[0].climbing).toBe(true)
    expect(flags[0].hot).toBe(false)
  })

  it("does not call a steady rate climbing", () => {
    const flags = seatHealth([
      seat({
        month: { approved: 80, denied: 20, escalated: 0 }, // 20%
        recent: { approved: 8, denied: 2, escalated: 0 }, // 20% — same
      }),
    ])
    expect(flags).toEqual([])
  })

  it("returns nothing for a healthy fleet and sorts worst-first otherwise", () => {
    expect(seatHealth([seat({ month: { approved: 50, denied: 1, escalated: 2 } })])).toEqual([])
    const flags = seatHealth([
      seat({ id: "mild", name: "mild", month: { approved: 7, denied: 3, escalated: 0 } }), // 30%
      seat({ id: "bad", name: "bad", month: { approved: 2, denied: 8, escalated: 0 } }), // 80%
    ])
    expect(flags.map((f) => f.id)).toEqual(["bad", "mild"])
  })

  it("carries the top denial code through", () => {
    const flags = seatHealth([
      seat({ month: { approved: 5, denied: 5, escalated: 0 }, topDenial: { code: "PER_TXN_LIMIT", count: 4 } }),
    ])
    expect(flags[0].topDenial).toEqual({ code: "PER_TXN_LIMIT", count: 4 })
  })
})
