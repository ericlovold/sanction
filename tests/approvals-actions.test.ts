import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: approvals/actions.ts mutations (resolve,
// add/remove webhook) now sit behind requireSessionRole("admin") instead of
// the bare getSessionWallet — a viewer resolves to the same null as no
// session. addWebhookAction's own event-routing behavior is already covered
// by tests/webhook-routing.test.ts; this file is just the role floor.
const { dbMock, sessionMock, approvalsMock, subtreeMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { webhook: { findUnique: vi.fn(), delete: vi.fn() } },
  sessionMock: { requireSessionRole: vi.fn() },
  approvalsMock: { resolveApproval: vi.fn() },
  subtreeMock: { subtreeWalletIds: vi.fn(async () => ({ ids: ["wallet_1"] })) },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/approvals", () => approvalsMock)
vi.mock("@/lib/walletSubtree", () => subtreeMock)
vi.mock("@/lib/webhooks", () => ({
  generateWebhookSecret: vi.fn(() => "whsec_x"),
  deliverPing: vi.fn(async () => {}),
  isPublicHttpsUrl: vi.fn(() => true),
  KNOWN_EVENTS: ["*", "budget.threshold"],
  DEFAULT_EVENTS: ["*"],
}))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: (fn: () => void) => fn() }
})
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { resolveApprovalAction, removeWebhookAction } from "../app/dashboard/approvals/actions"

const WALLET = { id: "wallet_1", ownerEmail: "cto@meridian.test" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => vi.clearAllMocks())

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
