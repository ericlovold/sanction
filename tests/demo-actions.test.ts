import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  resolveApproval: vi.fn(),
  getDemoEscalation: vi.fn(),
  revalidatePath: vi.fn(),
  rateLimit: vi.fn(),
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }))
vi.mock("@/lib/db", () => ({ db: { pendingApproval: { findFirst: mocks.findFirst, create: mocks.create } } }))
vi.mock("@/lib/approvals", () => ({ resolveApproval: mocks.resolveApproval }))
vi.mock("@/lib/demo", () => ({ getDemoEscalation: mocks.getDemoEscalation }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.rateLimit, ipFromHeaders: () => "127.0.0.1" }))
vi.mock("@/lib/walletSubtree", () => ({ subtreeWalletIds: async () => ({ ids: ["demo-wallet", "demo-child"] }) }))

import { decideDemoApprovalAction, decideDemoEscalationAction } from "@/app/dashboard/demo-actions"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_WALLET_ID", "demo-wallet")
  mocks.rateLimit.mockResolvedValue({ ok: true })
  mocks.findFirst.mockResolvedValue({ id: "pending-1", walletId: "demo-child", agentId: "agent-1", actionType: "spend" })
  mocks.resolveApproval.mockResolvedValue({ ok: true })
  mocks.create.mockResolvedValue({ id: "pending-2" })
  mocks.getDemoEscalation.mockResolvedValue({ id: "pending-2" })
})

afterEach(() => { vi.unstubAllEnvs() })

function dashboardDecision(approvalId = "pending-1", decision = "approve") {
  const form = new FormData()
  form.set("approval_id", approvalId)
  form.set("decision", decision)
  return decideDemoApprovalAction(form)
}

describe("demo decisions refresh the public platform snapshot", () => {
  it.each(["landing", "dashboard"])("does not invalidate for a rate-limited %s attempt", async (surface) => {
    mocks.rateLimit.mockResolvedValue({ ok: false })
    if (surface === "landing") await decideDemoEscalationAction("pending-1", "approve")
    else await dashboardDecision()
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.resolveApproval).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each(["landing", "dashboard"])("does not invalidate a %s attempt when no demo wallet is configured", async (surface) => {
    vi.stubEnv("SANCTION_WALLET_ID", "")
    if (surface === "landing") await decideDemoEscalationAction("pending-1", "approve")
    else await dashboardDecision()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each(["landing", "dashboard"])("does not invalidate a %s attempt with an empty approval ID", async (surface) => {
    if (surface === "landing") await decideDemoEscalationAction("", "approve")
    else await dashboardDecision("")
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.resolveApproval).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("does not invalidate an unsupported decision", async () => {
    await dashboardDecision("pending-1", "cancel")
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.resolveApproval).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each(["landing", "dashboard"])("invalidates after a successful %s decision and replenishment", async (surface) => {
    if (surface === "landing") {
      expect(await decideDemoEscalationAction("pending-1", "approve")).toEqual({ ok: true, next: { id: "pending-2" } })
    } else {
      await dashboardDecision()
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard")
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/approvals")
    }
    expect(mocks.resolveApproval).toHaveBeenCalledWith(["demo-wallet", "demo-child"], "pending-1", "approve", undefined, "demo visitor")
    expect(mocks.create).toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform")
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.create.mock.invocationCallOrder[0])
  })

  it.each(["landing", "dashboard"])("invalidates a stale %s card after another visitor already decided", async (surface) => {
    mocks.findFirst.mockResolvedValue(null)
    if (surface === "landing") {
      expect(await decideDemoEscalationAction("pending-1", "approve")).toEqual({ ok: false, next: { id: "pending-2" } })
    } else {
      await dashboardDecision()
    }
    expect(mocks.resolveApproval).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform")
  })

  it.each(["landing", "dashboard"])("invalidates the %s card when replenishment fails after a committed decision", async (surface) => {
    mocks.create.mockRejectedValueOnce(new Error("replenishment failed"))
    const decision = surface === "landing" ? decideDemoEscalationAction("pending-1", "approve") : dashboardDecision()
    await expect(decision).rejects.toThrow("replenishment failed")
    expect(mocks.resolveApproval).toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform")
  })
})
