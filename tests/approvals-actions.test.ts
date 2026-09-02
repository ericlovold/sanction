import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: approvals/actions.ts mutations (resolve,
// add/remove webhook) now sit behind requireSessionRole("admin") instead of
// the bare getSessionWallet — a viewer resolves to the same null as no
// session. addWebhookAction's own event-routing behavior is already covered
// by tests/webhook-routing.test.ts; this file is just the role floor.
const { dbMock, sessionMock, approvalsMock, subtreeMock, revalidateMock, tenantMock } = vi.hoisted(() => ({
  dbMock: {
    webhook: { findUnique: vi.fn(), delete: vi.fn() },
    slackInstall: { updateMany: vi.fn() },
    agent: { findFirst: vi.fn() },
    policy: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  sessionMock: { requireSessionRole: vi.fn() },
  approvalsMock: { resolveApproval: vi.fn(), createSpendPendingApproval: vi.fn() },
  subtreeMock: { subtreeWalletIds: vi.fn(async () => ({ ids: ["wallet_1"] })) },
  revalidateMock: vi.fn(),
  tenantMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/approvals", () => approvalsMock)
vi.mock("@/lib/walletSubtree", () => subtreeMock)
vi.mock("@/lib/webhooks", () => ({
  generateWebhookSecret: vi.fn(() => "whsec_x"),
  deliverPing: vi.fn(async () => {}),
  deliverEvent: vi.fn(async () => {}),
  approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${id}` : ""}`,
  isPublicHttpsUrl: vi.fn(() => true),
  KNOWN_EVENTS: ["*", "budget.threshold"],
  DEFAULT_EVENTS: ["*"],
}))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: (fn: () => void) => fn() }
})
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/rls", () => ({
  withTenant: (...args: unknown[]) => tenantMock(...args),
}))

import { resolveApprovalAction, removeWebhookAction, revokeSlackInstallAction, sendTestEscalationAction, TEST_ESCALATION } from "../app/dashboard/approvals/actions"
import { deliverEvent } from "../lib/webhooks"

const WALLET = { id: "wallet_1", ownerEmail: "cto@meridian.test" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantMock.mockImplementation(async (_wallet: string, fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

describe("resolveApprovalAction — role floor", () => {
  it("denies without reaching resolveApproval when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await resolveApprovalAction({ ok: false, message: "" }, form({ approval_id: "a1", decision: "approve" }))
    expect(res.ok).toBe(false)
    expect(approvalsMock.resolveApproval).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and proceeds once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    approvalsMock.resolveApproval.mockResolvedValue({ ok: true })
    const res = await resolveApprovalAction({ ok: false, message: "" }, form({ approval_id: "a1", decision: "approve" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(res.ok).toBe(true)
  })
})

describe("removeWebhookAction — role floor", () => {
  it("denies without touching the db when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    await removeWebhookAction(form({ id: "wh_1" }))
    expect(dbMock.webhook.findUnique).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and removes an owned webhook once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    dbMock.webhook.findUnique.mockResolvedValue({ id: "wh_1", walletId: "wallet_1" })
    await removeWebhookAction(form({ id: "wh_1" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(dbMock.webhook.delete).toHaveBeenCalledWith({ where: { id: "wh_1" } })
  })
})

describe("revokeSlackInstallAction — role floor", () => {
  it("denies without touching the install when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    await revokeSlackInstallAction(form({ id: "si_1" }))
    expect(tenantMock).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and revokes an owned install once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    dbMock.slackInstall.updateMany.mockResolvedValue({ count: 1 })
    await revokeSlackInstallAction(form({ id: "si_1" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(dbMock.slackInstall.updateMany).toHaveBeenCalledWith({
      where: { id: "si_1", walletId: "wallet_1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })
})

describe("sendTestEscalationAction — SLACK-2, prove the loop", () => {
  const state = { ok: false, message: "" }
  beforeEach(() => {
    dbMock.agent.findFirst.mockResolvedValue({ id: "agent_1", name: "nightly-coder" })
    dbMock.policy.findUnique.mockResolvedValue({ escalationTimeoutMins: 60, escalationTimeoutAction: "deny" })
    dbMock.authorizationRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "req_t", createdAt: new Date(), ...data }))
    dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
    approvalsMock.createSpendPendingApproval.mockResolvedValue({ id: "pa_t", actionType: "spend.purchase", resourceJson: { kind: "spend" }, reason: null })
  })

  it("role floor: nothing is raised without an admin session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await sendTestEscalationAction(state, form({}))
    expect(res.ok).toBe(false)
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("tells the admin to add an agent when the wallet has none", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    dbMock.agent.findFirst.mockResolvedValue(null)
    const res = await sendTestEscalationAction(state, form({}))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/agent/i)
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("raises a real, labeled escalation and fans it out like the route does", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    const res = await sendTestEscalationAction(state, form({}))
    expect(res.ok).toBe(true)
    const row = dbMock.authorizationRequest.create.mock.calls[0][0].data
    expect(row).toMatchObject({ agentId: "agent_1", status: "escalated", amountUsd: TEST_ESCALATION.amountUsd, merchant: TEST_ESCALATION.merchant, detailsJson: { tags: ["test"] } })
    expect(approvalsMock.createSpendPendingApproval).toHaveBeenCalledOnce()
    expect(approvalsMock.createSpendPendingApproval.mock.calls[0][1]).toMatchObject({ walletId: "wallet_1", agentName: "nightly-coder" })
    const events = vi.mocked(deliverEvent).mock.calls.map((c) => c[1])
    expect(events).toEqual(["approval.created", "escalation.created"])
    expect(vi.mocked(deliverEvent).mock.calls[0][2]).toMatchObject({ approval_id: "pa_t", request_id: "req_t", approve_url: "https://test.local/approve?review=req_t" })
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/approvals")
  })
})
