import { beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock, subtreeMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findMany: vi.fn() },
    agent: { findMany: vi.fn() },
    policy: { findMany: vi.fn() },
    pendingApproval: { groupBy: vi.fn(), findMany: vi.fn() },
    tokenLog: { groupBy: vi.fn() },
    authorizationRequest: { groupBy: vi.fn() },
  },
  subtreeMock: { subtreeWalletIds: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/walletSubtree", () => subtreeMock)

import { agentStamp, getRoster, getWaiting } from "../lib/roster"

describe("agentStamp", () => {
  it("is live when the agent is active and nothing is waiting", () => {
    expect(agentStamp({ isActive: true }, 0)).toBe("live")
  })

  it("is paused when an escalation is waiting", () => {
    expect(agentStamp({ isActive: true }, 2)).toBe("paused")
  })

  it("is blocked when the key expires, even when still enabled with waiting requests", () => {
    const now = new Date("2026-11-24T12:00:00Z")
    expect(agentStamp({ isActive: true, expiresAt: now }, 2, now)).toBe("blocked")
    expect(agentStamp({ isActive: true, expiresAt: new Date(now.getTime() + 1) }, 2, now)).toBe("paused")
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

  it("counts only requests that can still be decided, and carries last use", async () => {
    const used = new Date("2026-11-20T12:00:00Z")
    dbMock.agent.findMany.mockResolvedValue([
      { id: "a1", name: "nightly-coder", holder: null, isActive: true, walletId: "root", lastUsedAt: used },
    ])
    const snapshot = new Date("2026-11-24T12:00:00Z")
    const { root } = await getRoster("root", snapshot)
    expect(root.agents[0]?.lastUsedAt).toBe(used)
    const where = dbMock.pendingApproval.groupBy.mock.calls[0]?.[0]?.where
    expect(where.status).toBe("pending")
    // Same live set as the nav badge: no deadline, or a deadline still ahead.
    expect(where.OR[0]).toEqual({ expiresAt: null })
    expect(where.OR[1].expiresAt.gt).toBe(snapshot)
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

describe("getWaiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subtreeMock.subtreeWalletIds.mockResolvedValue({ ids: ["root", "child"] })
  })

  it("names each waiting request the way the inbox does, oldest first", async () => {
    const asked = new Date("2026-11-20T12:00:00Z")
    dbMock.pendingApproval.findMany.mockResolvedValue([
      {
        id: "p1", actionType: "spend.purchase", reason: "Exceeds escalation threshold", createdAt: asked,
        resourceJson: { kind: "spend", amount_usd: 480, merchant: "Datadog" },
        agent: { name: "buyer" }, wallet: { name: "Finance" },
      },
      {
        id: "p2", actionType: "tool.invoke", reason: null, createdAt: asked,
        resourceJson: { kind: "tool", tool: "claude-code.Bash" },
        agent: { name: "coder" }, wallet: { name: "Eric" },
      },
    ])
    const snapshot = new Date("2026-11-24T12:00:00Z")
    const items = await getWaiting("root", 2, snapshot)
    expect(items).toEqual([
      { id: "p1", title: "$480.00 Datadog", agentName: "buyer", groupName: "Finance", reason: "Exceeds escalation threshold", createdAt: asked },
      { id: "p2", title: "claude-code.Bash", agentName: "coder", groupName: "Eric", reason: null, createdAt: asked },
    ])
    const args = dbMock.pendingApproval.findMany.mock.calls[0]?.[0]
    expect(args.take).toBe(2)
    expect(args.orderBy).toEqual({ createdAt: "asc" })
    expect(args.where.walletId).toEqual({ in: ["root", "child"] })
    expect(args.where.OR[0]).toEqual({ expiresAt: null })
    expect(args.where.OR[1].expiresAt.gt).toBe(snapshot)
  })
})
