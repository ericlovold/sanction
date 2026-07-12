import { describe, expect, it } from "vitest"
import { frozenSubtreeWalletIds } from "../lib/walletSubtree"

// KILL-1 inheritance: a wallet is effectively frozen if it or any ancestor is
// frozen. The Outcomes rollup keys its FROZEN pills on this walk.

const w = (id: string, parentId: string | null, frozen: boolean) => ({
  id,
  parentId,
  frozenAt: frozen ? new Date("2026-07-01") : null,
})

describe("frozenSubtreeWalletIds", () => {
  it("marks a pool frozen when it is frozen itself", () => {
    const frozen = frozenSubtreeWalletIds([w("root", null, false), w("a", "root", true)])
    expect(frozen.has("a")).toBe(true)
    expect(frozen.has("root")).toBe(false)
  })

  it("propagates a frozen ancestor down every descendant", () => {
    const frozen = frozenSubtreeWalletIds([
      w("root", null, false),
      w("company", "root", true), // frozen mid-tree
      w("team", "company", false),
      w("squad", "team", false),
    ])
    expect([...frozen].sort()).toEqual(["company", "squad", "team"])
    expect(frozen.has("root")).toBe(false)
  })

  it("leaves an unfrozen tree entirely unfrozen", () => {
    const frozen = frozenSubtreeWalletIds([w("root", null, false), w("a", "root", false), w("b", "a", false)])
    expect(frozen.size).toBe(0)
  })

  it("treats ancestors outside the given set as not frozen", () => {
    // parent 'ghost' is not in the row set — its state is unknown, so not frozen.
    const frozen = frozenSubtreeWalletIds([w("child", "ghost", false)])
    expect(frozen.size).toBe(0)
  })

  it("is cycle-safe (a self-referential/looping parentId does not hang)", () => {
    const frozen = frozenSubtreeWalletIds([w("x", "y", false), w("y", "x", false)])
    expect(frozen.size).toBe(0)
  })

  it("a cycle that contains a frozen node freezes the whole cycle", () => {
    const frozen = frozenSubtreeWalletIds([w("x", "y", true), w("y", "x", false)])
    expect(frozen.has("x")).toBe(true)
    expect(frozen.has("y")).toBe(true)
  })
})
