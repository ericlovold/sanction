import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { afterMock, dbMock, deliverEventMock, txMock } = vi.hoisted(() => {
  const tx = {
    authorizationRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    grant: { create: vi.fn() },
    pendingApproval: { findUnique: vi.fn(), updateMany: vi.fn() },
  }
  return {
    afterMock: vi.fn((cb: () => unknown) => cb()),
    dbMock: {
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      authorizationRequest: { findUnique: vi.fn(), update: vi.fn() },
      pendingApproval: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    deliverEventMock: vi.fn(async () => undefined),
    txMock: tx,
  }
})

vi.mock("next/server", () => ({ after: afterMock }))
vi.mock("../lib/db", () => ({ db: dbMock }))
vi.mock("../lib/webhooks", () => ({ deliverEvent: deliverEventMock }))

import { resolveApproval } from "../lib/approvals"

const resolvedAt = new Date("2026-07-01T12:00:00.000Z")

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: "pa_1",
    walletId: "wallet_1",
    agentId: "agent_1",
    actionType: "spend.purchase",
    status: "pending",
    subjectJson: { agent_id: "agent_1", agent_name: "AIIA" },
    resourceJson: { kind: "spend", action: "purchase", amount_usd: 40, merchant: "OpenAI", category: "software" },
    constraintsJson: { one_use: true, grant_ttl_mins: 30, timeout_mins: 60, timeout_action: "deny" },
    reason: "Exceeds escalation threshold",
    code: "ESCALATION_REQUIRED",
    sourceType: "authorization_request",
    sourceId: "auth_1",
    expiresAt: new Date("2026-07-01T13:00:00.000Z"),
    resolvedAt: null,
    resolutionNote: null,
    createdAt: new Date("2026-07-01T11:30:00.000Z"),
    updatedAt: new Date("2026-07-01T11:30:00.000Z"),
    agent: { name: "AIIA" },
    ...overrides,
  }
}

function authRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth_1",
    agentId: "agent_1",
    action: "purchase",
    amountUsd: 40,
    merchant: "OpenAI",
    category: "software",
    description: null,
    status: "approved",
    decidedAt: resolvedAt,
    decisionNote: "Looks safe",
    idempotencyKey: null,
    createdAt: new Date("2026-07-01T11:30:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(resolvedAt)
  vi.clearAllMocks()

  dbMock.$transaction.mockImplementation((cb) => cb(txMock))
  dbMock.pendingApproval.findFirst.mockResolvedValue(approval())
  txMock.pendingApproval.updateMany.mockResolvedValue({ count: 1 })
  txMock.pendingApproval.findUnique.mockResolvedValue(approval({ status: "approved", resolvedAt, resolutionNote: "Looks safe" }))
  txMock.grant.create.mockResolvedValue({ id: "grant_1", status: "active" })
  txMock.authorizationRequest.updateMany.mockResolvedValue({ count: 1 })
  txMock.authorizationRequest.findUnique.mockResolvedValue(authRequest())
})

afterEach(() => {
  vi.useRealTimers()
})

describe("resolveApproval grant issuance", () => {
  it("approves a pending approval, mints a grant with provenance, and resolves the source spend request", async () => {
    const result = await resolveApproval("wallet_1", "pa_1", "approve", "Looks safe")

    expect(result.ok).toBe(true)
    expect(txMock.pendingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: "pa_1", walletId: "wallet_1", status: "pending" },
      data: { status: "approved", resolvedAt, resolvedBy: "owner", resolutionNote: "Looks safe" },
    })
    expect(txMock.grant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: "wallet_1",
        agentId: "agent_1",
        actionType: "spend.purchase",
        sourceType: "authorization_request",
        sourceId: "auth_1",
        issuedBy: "owner",
        issuedFromApprovalId: "pa_1",
        justification: "Looks safe",
        expiresAt: new Date("2026-07-01T12:30:00.000Z"),
      }),
    })
    expect(txMock.authorizationRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "auth_1", status: "escalated" },
      data: { status: "approved", decidedAt: resolvedAt, decisionNote: "Looks safe" },
    })
    expect(afterMock).toHaveBeenCalledOnce()
  })

  it("does not mint a grant when another resolver wins the pending-approval race", async () => {
    txMock.pendingApproval.updateMany.mockResolvedValue({ count: 0 })

    const result = await resolveApproval("wallet_1", "pa_1", "approve", "Looks safe")

    expect(result).toEqual({ ok: false, error: "Approval already resolved", status: 409 })
    expect(txMock.grant.create).not.toHaveBeenCalled()
    expect(txMock.authorizationRequest.updateMany).not.toHaveBeenCalled()
    expect(afterMock).not.toHaveBeenCalled()
  })
})
