import { describe, expect, it } from "vitest"
import { closestToLimit, countAgentsAtLimit, denialReason, meter, paceNote, shares, zoneLabel, type LimitAgent } from "../lib/spendView"

describe("meter", () => {
  it("reads within, close and at the limit", () => {
    expect(meter(1, 10)).toEqual({ pct: 10, fill: 10, state: "ok" })
    expect(meter(8, 10).state).toBe("near")
    expect(meter(10, 10)).toEqual({ pct: 100, fill: 100, state: "at" })
  })

  it("keeps the bar full and the share honest when over the limit", () => {
    expect(meter(19, 10)).toEqual({ pct: 190, fill: 100, state: "at" })
    expect(meter(1e9, 1).pct).toBe(999)
  })

  it("treats a zero limit as already reached, as the engine does", () => {
    // Gateway: spent >= limit refuses at 0 >= 0. /authorize: any purchase
    // takes the total over a zero limit.
    expect(meter(0, 0)).toEqual({ pct: 100, fill: 100, state: "at" })
  })
})

describe("closestToLimit", () => {
  const agent = (id: string, model: number | null, purchases: number | null): LimitAgent => ({
    id, name: id, modelLimitCents: model, purchaseLimitCents: purchases,
  })

  it("measures each agent against its own limit, never a total against one limit", () => {
    // Ten agents at $4 of a $10 limit: $40 in total, and nobody is near.
    const agents = Array.from({ length: 10 }, (_, i) => agent(`a${i}`, 1000, 5000))
    const today = new Map(agents.map((a) => [a.id, { model: 4, purchases: 0 }]))
    expect(closestToLimit(agents, today)).toEqual([])
  })

  it("lists agents from half a limit up, the ones at a limit first", () => {
    const agents = [agent("half", 1000, 5000), agent("full", 1000, 5000), agent("quiet", 1000, 5000), agent("near", 1000, 5000)]
    const today = new Map([
      ["half", { model: 5, purchases: 0 }],
      ["full", { model: 2, purchases: 50 }],
      ["quiet", { model: 4.9, purchases: 24 }],
      ["near", { model: 9, purchases: 0 }],
    ])
    const rows = closestToLimit(agents, today)
    expect(rows.map((r) => `${r.name}:${r.kind}:${r.view.state}`)).toEqual([
      "full:purchases:at",
      "near:model:near",
      "half:model:ok",
    ])
    expect(rows[0]).toMatchObject({ spentUsd: 50, limitUsd: 50 })
  })

  it("skips a limit that does not apply, an agent with nothing spent, and an agent with no activity", () => {
    const agents = [agent("no-limit", null, null), agent("zero", 0, 0), agent("absent", 1000, 1000)]
    const today = new Map([
      ["no-limit", { model: 500, purchases: 500 }],
      ["zero", { model: 0, purchases: 0 }],
    ])
    expect(closestToLimit(agents, today)).toEqual([])
  })

  it("orders ties by name", () => {
    const agents = [agent("b", 1000, null), agent("a", 1000, null)]
    const today = new Map([["a", { model: 6, purchases: 0 }], ["b", { model: 6, purchases: 0 }]])
    expect(closestToLimit(agents, today).map((r) => r.name)).toEqual(["a", "b"])
  })
})

describe("paceNote", () => {
  const noon = new Date(2026, 10, 21, 12, 0, 0)

  it("says the limit is reached, including a zero limit", () => {
    expect(paceNote(10, 10, noon)).toBe("Recorded usage meets this limit; live available budget may differ.")
    expect(paceNote(0, 0, noon)).toBe("Recorded usage meets this limit; live available budget may differ.")
  })

  it("projects to midnight when the day will end under the limit", () => {
    expect(paceNote(2, 10, noon)).toBe("At this pace, about $4.00 by midnight.")
  })

  it("names the time, with its zone, when the limit will be reached today", () => {
    // $8 by noon reaches $10 at 3:00 PM on a straight line.
    expect(paceNote(8, 10, noon)).toMatch(/^At this pace the limit is reached around 3:00 PM \S+\.$/)
  })

  it("stays quiet with nothing spent or too early in the day", () => {
    expect(paceNote(0, 10, noon)).toBeNull()
    expect(paceNote(1, 10, new Date(2026, 10, 21, 0, 30, 0))).toBeNull()
  })
})

describe("shares, zoneLabel and denialReason", () => {
  it("scales each amount to the largest", () => {
    expect(shares([10, 5, 0])).toEqual([1, 0.5, 0])
    expect(shares([0, 0])).toEqual([0, 0])
    expect(shares([])).toEqual([])
    expect(shares([4, -1])).toEqual([1, 0])
  })

  it("names the server's zone", () => {
    expect(zoneLabel(new Date(2026, 10, 21))).toMatch(/\S/)
  })

  it("puts a refusal code in plain words, with a fallback", () => {
    expect(denialReason("PER_TXN_LIMIT")).toBe("over the largest single purchase")
    expect(denialReason("DAILY_BUDGET_EXCEEDED")).toBe("over its daily limit")
    expect(denialReason("SOMETHING_NEW")).toBe("refused by policy")
  })
})


describe("agent counts", () => {
  it("counts an agent once when both model and purchase usage meet limits", () => {
    const rows = closestToLimit([
      { id: "both", name: "Both", modelLimitCents: 100, purchaseLimitCents: 100 },
      { id: "near", name: "Near", modelLimitCents: 100, purchaseLimitCents: null },
    ], new Map([["both", { model: 1, purchases: 1 }], ["near", { model: 0.9, purchases: 0 }]]))
    expect(rows).toHaveLength(3)
    expect(countAgentsAtLimit(rows)).toBe(1)
  })
})
