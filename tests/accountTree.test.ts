import { describe, it, expect } from "vitest"
import { buildRollupTree, type FlatNode } from "../lib/accountTree"

const node = (id: string, parentId: string | null, today = 0, month = 0, tok = 0): FlatNode => ({
  id,
  parentId,
  name: id,
  spend: { today_usd: today, month_usd: month, token_today_usd: tok },
})

describe("buildRollupTree", () => {
  it("a leaf rolls up to its own spend", () => {
    const t = buildRollupTree([node("a", null, 5, 5, 1)], "a")!
    expect(t.rollup).toEqual({ today_usd: 5, month_usd: 5, token_today_usd: 1 })
    expect(t.children).toEqual([])
  })

  it("sums a parent's own spend plus every child", () => {
    const t = buildRollupTree([node("a", null, 10, 10, 2), node("b", "a", 5, 5, 1), node("c", "a", 3, 3, 0)], "a")!
    expect(t.spend.today_usd).toBe(10) // node's own, untouched
    expect(t.rollup).toEqual({ today_usd: 18, month_usd: 18, token_today_usd: 3 })
    expect(t.children).toHaveLength(2)
  })

  it("cascades rollup up multiple levels (a → b → c)", () => {
    const t = buildRollupTree([node("a", null, 1), node("b", "a", 2), node("c", "b", 4)], "a")!
    expect(t.rollup.today_usd).toBe(7) // 1 + 2 + 4
    expect(t.children[0].rollup.today_usd).toBe(6) // b: 2 + 4
    expect(t.children[0].children[0].rollup.today_usd).toBe(4) // c: 4
  })

  it("returns null when the root is absent", () => {
    expect(buildRollupTree([node("b", "a", 1)], "a")).toBeNull()
  })

  it("only includes the subtree under the root (ignores unrelated roots)", () => {
    const t = buildRollupTree([node("a", null, 1), node("b", "a", 2), node("z", null, 99)], "a")!
    expect(t.children.map((c) => c.id)).toEqual(["b"])
    expect(t.rollup.today_usd).toBe(3) // a + b, not z
  })

  it("is cycle-safe — never recurses a node twice", () => {
    // a.parent = b, b.parent = a (a cycle that shouldn't exist, but must not hang)
    const t = buildRollupTree([node("a", "b", 1), node("b", "a", 2)], "a")!
    expect(t.id).toBe("a")
    expect(t.children.map((c) => c.id)).toEqual(["b"])
    expect(t.children[0].children).toEqual([]) // a not revisited under b
    expect(t.rollup.today_usd).toBe(3)
  })

  it("kills float dust when summing", () => {
    const t = buildRollupTree([node("a", null, 0.1), node("b", "a", 0.2)], "a")!
    expect(t.rollup.today_usd).toBe(0.3) // not 0.30000000000000004
  })
})
