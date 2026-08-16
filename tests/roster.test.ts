import { beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock, subtreeMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findMany: vi.fn() },
    agent: { findMany: vi.fn() },
    policy: { findMany: vi.fn() },
    pendingApproval: { groupBy: vi.fn() },
    tokenLog: { groupBy: vi.fn() },
    authorizationRequest: { groupBy: vi.fn() },
  },
  subtreeMock: { subtreeWalletIds: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/walletSubtree", () => subtreeMock)

import { agentStamp, getRoster } from "../lib/roster"

describe("agentStamp", () => {
  it("is live when the agent is active and nothing is waiting", () => {
    expect(agentStamp({ isActive: true }, 0)).toBe("live")
  })

  it("is paused when an escalation is waiting", () => {
    expect(agentStamp({ isActive: true }, 2)).toBe("paused")
  })

  it("is blocked when the seat is inactive — even if something is pending", () => {
    expect(agentStamp({ isActive: false }, 1)).toBe("blocked")
  })
})

describe("getRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subtreeMock.subtreeWalletIds.mockResolvedValue({ ids: ["root", "child"] })
    dbMock.wallet.findMany.mockResolvedValue([
      { id: "root", name: "Eric", parentId: null },
      { id: "child", name: "Marketing", parentId: "root" },
    ])
    dbMock.agent.findMany.mockResolvedValue([
      { id: "a1", name: "nightly-coder", holder: null, isActive: true, walletId: "root" },
      { id: "a2", name: "ads", holder: "Sam", isActive: true, walletId: "child" },
    ])
    dbMock.policy.findMany.mockResolvedValue([{ walletId: "root", monthlySpendBudgetUsd: 800_000 }])
    dbMock.pendingApproval.groupBy.mockResolvedValue([{ agentId: "a2", _count: { _all: 1 } }])
    dbMock.tokenLog.groupBy.mockResolvedValue([{ agentId: "a1", _sum: { costUsd: 4 } }])
    dbMock.authorizationRequest.groupBy.mockResolvedValue([{ agentId: "a2", _sum: { amountUsd: 12 } }])
  })

  it("nests child groups and rolls spend up", async () => {
    const { root, pendingTotal, agentCount } = await getRoster("root")
    expect(agentCount).toBe(2)
    expect(pendingTotal).toBe(1)
    expect(root.name).toBe("Eric")
    expect(root.spendCapUsd).toBe(8000)
    expect(root.agents[0]?.stamp).toBe("live")
    expect(root.children[0]?.name).toBe("Marketing")
    expect(root.children[0]?.agents[0]?.stamp).toBe("paused")
    expect(root.monthUsd).toBe(16)
  })

  it("returns an empty root when the wallet row is missing", async () => {
    subtreeMock.subtreeWalletIds.mockResolvedValue({ ids: ["ghost"] })
    dbMock.wallet.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.policy.findMany.mockResolvedValue([])
    dbMock.pendingApproval.groupBy.mockResolvedValue([])
    const { root, agentCount } = await getRoster("ghost")
    expect(agentCount).toBe(0)
    expect(root.agents).toEqual([])
  })
})
