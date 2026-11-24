import { describe, expect, it } from "vitest"
import { allocationMoves, delegatedTokenBudgetUsd, grantAuthorityUsd, poolStatus, spendCapPressure } from "../lib/budgetPools"

describe("grantAuthorityUsd", () => {
  it("prefers an explicit max amount constraint", () => {
    expect(grantAuthorityUsd({ amount_usd: 25 }, { max_amount_usd: 10 })).toBe(10)
  })

  it("falls back to the spend resource amount", () => {
    expect(grantAuthorityUsd({ amount_usd: 25 }, null)).toBe(25)
  })

  it("returns zero for non-spend grants", () => {
    expect(grantAuthorityUsd({ tool_name: "github.create_issue" }, { one_use: true })).toBe(0)
  })
})

describe("spendCapPressure and poolStatus", () => {
  it("returns null when no cap is set", () => {
    expect(spendCapPressure(20, null)).toBeNull()
    expect(poolStatus(20, null)).toBe("cap_missing")
  })

  it("classifies warm, hot, and over-cap pools", () => {
    expect(poolStatus(49, 100)).toBe("clear")
    expect(poolStatus(50, 100)).toBe("warm")
    expect(poolStatus(80, 100)).toBe("hot")
    expect(poolStatus(100, 100)).toBe("over_cap")
  })
})

describe("allocationMoves", () => {
  it("treats an uncapped pool as the first move", () => {
    const moves = allocationMoves({
      capUsd: null,
      spendTodayUsd: 0,
      delegatedDailyUsd: 500,
      activeGrantUsd: 0,
      pendingApprovals: 0,
      deniedMonth: 0,
      escalatedMonth: 0,
      modelCount: 0,
      largestModelShare: 0,
    })
    expect(moves[0].id).toBe("set-pool-cap")
  })

  it("flags over-delegation against a hard pool cap", () => {
    const moves = allocationMoves({
      capUsd: 100,
      spendTodayUsd: 10,
      delegatedDailyUsd: 140,
      activeGrantUsd: 0,
      pendingApprovals: 0,
      deniedMonth: 0,
      escalatedMonth: 0,
      modelCount: 0,
      largestModelShare: 0,
    })
    expect(moves.map((m) => m.id)).toContain("right-size-delegation")
  })

  it("flags active grant exposure against remaining cap", () => {
    const moves = allocationMoves({
      capUsd: 100,
      spendTodayUsd: 80,
      delegatedDailyUsd: 100,
      activeGrantUsd: 30,
      pendingApprovals: 0,
      deniedMonth: 0,
      escalatedMonth: 0,
      modelCount: 0,
      largestModelShare: 0,
    })
    expect(moves.map((m) => m.id)).toContain("grant-exposure")
  })
})


describe("delegatedTokenBudgetUsd in a scoped group view", () => {
  const team = { id: "team", parentId: "org", policy: null }
  const agent = { walletId: "team", dailyTokenBudgetUsd: null }

  it("uses the ancestor default without adding its wallet to the visible subtree", () => {
    const visible = new Map([[team.id, team]])
    expect(delegatedTokenBudgetUsd(agent, visible, 500)).toBe(5)
    expect([...visible.keys()]).toEqual(["team"])
  })

  it.each([0, 2000])("keeps an explicit local policy of %i cents", (dailyTokenBudgetUsd) => {
    const visible = new Map([[team.id, { ...team, policy: { dailyTokenBudgetUsd } }]])
    expect(delegatedTokenBudgetUsd(agent, visible, 500)).toBe(dailyTokenBudgetUsd / 100)
  })

  it("uses the nearest policy within the view before the external default", () => {
    const visible = new Map([
      ["team", { ...team, parentId: "dept", policy: null as { dailyTokenBudgetUsd: number } | null }],
      ["dept", { id: "dept", parentId: "org", policy: { dailyTokenBudgetUsd: 700 } }],
    ])
    expect(delegatedTokenBudgetUsd(agent, visible, 500)).toBe(7)
  })

  it.each([0, 2000])("preserves the agent override of %i cents", (dailyTokenBudgetUsd) => {
    expect(delegatedTokenBudgetUsd({ ...agent, dailyTokenBudgetUsd }, new Map([[team.id, team]]), 500))
      .toBe(dailyTokenBudgetUsd / 100)
  })

  it("preserves an inherited zero limit", () => {
    expect(delegatedTokenBudgetUsd(agent, new Map([[team.id, team]]), 0)).toBe(0)
  })
})
