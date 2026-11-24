import { describe, expect, it } from "vitest"
import { agentState, agentExpiringSoon, waitingApprovalWhere } from "@/lib/dashboardCounts"

const now = new Date("2026-11-24T12:00:00Z")
const before = new Date(now.getTime() - 1)
const after = new Date(now.getTime() + 1)

describe("dashboard agent states", () => {
  it("excludes expired keys from active at the exact authentication boundary", () => {
    expect(agentState({ isActive: true, expiresAt: before }, now)).toBe("expired")
    expect(agentState({ isActive: true, expiresAt: now.toISOString() }, now)).toBe("expired")
    expect(agentState({ isActive: true, expiresAt: after }, now)).toBe("active")
    expect(agentState({ isActive: true, expiresAt: null }, now)).toBe("active")
  })

  it("counts disabled expired agents only as off, matching their row label", () => {
    const agents = [
      { isActive: false, expiresAt: before },
      { isActive: false, expiresAt: null },
      { isActive: true, expiresAt: before },
      { isActive: true, expiresAt: after },
    ]
    const states = agents.map((agent) => agentState(agent, now))
    expect(states).toEqual(["revoked", "revoked", "expired", "active"])
    expect(states.filter((state) => state !== "active")).toHaveLength(3)
  })

  it("only warns about currently active agents expiring within seven days", () => {
    expect(agentExpiringSoon({ isActive: false, expiresAt: after }, now)).toBe(false)
    expect(agentExpiringSoon({ isActive: true, expiresAt: now }, now)).toBe(false)
    expect(agentExpiringSoon({ isActive: true, expiresAt: after }, now)).toBe(true)
    expect(agentExpiringSoon({ isActive: true, expiresAt: new Date(now.getTime() + 7 * 86400000) }, now)).toBe(true)
    expect(agentExpiringSoon({ isActive: true, expiresAt: new Date(now.getTime() + 7 * 86400000 + 1) }, now)).toBe(false)
  })
})

describe("actionable waiting approvals", () => {
  it("requires tenant scope, pending status, and a strictly future or absent deadline", () => {
    expect(waitingApprovalWhere(["root", "child"], now)).toEqual({
      walletId: { in: ["root", "child"] }, status: "pending",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    })
  })
})
