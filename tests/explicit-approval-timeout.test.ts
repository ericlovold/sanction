import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    authorizationRequest: { updateMany: vi.fn(), findUnique: vi.fn() },
    pendingApproval: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    grant: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/toolRequest", () => ({ sealToolRequest: vi.fn(async () => "sealed-request") }))
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn() }))
vi.mock("next/server", () => ({ after: vi.fn() }))

import { createToolPendingApproval, listPendingApprovals, settleIfExpired } from "../lib/approvals"

const createdAt = new Date("2026-10-01T12:00:00Z")
const row = {
  id: "request_explicit", status: "escalated", decisionNote: null, decidedAt: null, createdAt,
  detailsJson: { require_approval: true, approval_timeout_mins: 30 },
}
const approval = {
  id: "approval_explicit", walletId: "wallet_test", agentId: "agent_test", actionType: "tool.invoke",
  status: "pending", subjectJson: {}, resourceJson: { tool: "deploy" },
  constraintsJson: { timeout_mins: 30, timeout_action: "deny" },
  sourceType: "authorization_request", sourceId: row.id, createdAt,
  expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(createdAt.getTime() + 31 * 60_000))
  dbMock.$transaction.mockImplementation(async (fn) => fn(dbMock))
  dbMock.authorizationRequest.updateMany.mockResolvedValue({ count: 1 })
  dbMock.pendingApproval.updateMany.mockResolvedValue({ count: 1 })
  dbMock.pendingApproval.findFirst.mockResolvedValue(approval)
  dbMock.pendingApproval.findMany.mockResolvedValue([approval])
})
afterEach(() => vi.useRealTimers())

describe("explicit human approval timeout", () => {
  it.each([
    ["approve", { escalationTimeoutMins: 1, escalationTimeoutAction: "approve" }],
    ["disabled", { escalationTimeoutMins: 0, escalationTimeoutAction: "approve" }],
    ["lengthened", { escalationTimeoutMins: 120, escalationTimeoutAction: "approve" }],
    ["missing", null],
  ])("denies at its persisted deadline with %s current policy", async (_label, policy) => {
    const result = await settleIfExpired(row, policy)
    expect(result.status).toBe("denied")
    expect(result.decisionNote).toContain("after 30m")
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "denied" }),
    }))
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })

  it("ignores a shorter current deadline before the recorded deadline", async () => {
    vi.setSystemTime(new Date(createdAt.getTime() + 15 * 60_000))
    expect((await settleIfExpired(row, { escalationTimeoutMins: 1, escalationTimeoutAction: "approve" })).status)
      .toBe("escalated")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it.each([undefined, 0, -1, "30"])("fails closed after 60m with invalid or missing recorded deadline %s", async (timeout) => {
    vi.setSystemTime(new Date(createdAt.getTime() + 61 * 60_000))
    const result = await settleIfExpired({
      ...row, detailsJson: { require_approval: true, approval_timeout_mins: timeout },
    }, null)
    expect(result.status).toBe("denied")
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })

  it("persists deny-only constraints and expires through the inbox without a grant", async () => {
    dbMock.pendingApproval.create.mockImplementation(async ({ data }) => ({ ...approval, ...data }))
    const saved = await createToolPendingApproval(dbMock as never, {
      walletId: approval.walletId, agentName: "Test agent",
      request: { id: row.id, agentId: approval.agentId, tool: "deploy", server: null, createdAt },
      policy: { escalationTimeoutMins: 30, escalationTimeoutAction: "deny" },
      reason: "Caller requested human approval",
    })
    dbMock.pendingApproval.findMany.mockResolvedValue([saved])
    expect(await listPendingApprovals(approval.walletId)).toEqual([])
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "denied" }),
    }))
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })

  it("preserves normal policy timeout approval and grant minting", async () => {
    const result = await settleIfExpired({ ...row, detailsJson: {} }, {
      escalationTimeoutMins: 30, escalationTimeoutAction: "approve",
    })
    expect(result.status).toBe("approved")
    expect(dbMock.grant.create).toHaveBeenCalledOnce()
  })
})
