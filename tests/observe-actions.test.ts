import { beforeEach, describe, expect, it, vi } from "vitest"

// C2: the observe ↔ enforce flip is a policy mutation like any other — session
// gated, subtree-scoped, and revisioned. These tests pin that contract.

const { dbMock, revalidatePathMock, sessionMock } = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(),
    wallet: { findUnique: vi.fn(), findMany: vi.fn() },
    policy: { findUnique: vi.fn(), upsert: vi.fn() },
    policyRevision: { create: vi.fn() },
  }
  db.$transaction.mockImplementation((arg: ((client: typeof db) => unknown) | Promise<unknown>[]) =>
    typeof arg === "function" ? arg(db) : Promise.all(arg),
  )
  return { dbMock: db, revalidatePathMock: vi.fn(), sessionMock: { requireSessionRole: vi.fn() } }
})

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("../lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("../lib/session", () => sessionMock)
vi.mock("@/lib/session", () => sessionMock)

import { setEnforcementModeAction } from "../app/dashboard/observe/actions"

const prev = { ok: false, message: "" }

function form(entries: Record<string, string>) {
  const f = new FormData()
  for (const [key, value] of Object.entries(entries)) f.set(key, value)
  return f
}

// Subtree: wallet_root → pool_child. wallet_foreign exists but is outside it.
function setupSubtree() {
  dbMock.wallet.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
    ["wallet_root", "pool_child", "wallet_foreign"].includes(args.where.id) ? { id: args.where.id } : null,
  )
  dbMock.wallet.findMany.mockImplementation(async (args: { where: { parentId: { in: string[] } } }) =>
    args.where.parentId.in.includes("wallet_root") ? [{ id: "pool_child", parentId: "wallet_root" }] : [],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.requireSessionRole.mockResolvedValue({ id: "wallet_root" })
  setupSubtree()
  dbMock.policy.findUnique.mockResolvedValue({ id: "pol_child" })
  dbMock.policy.upsert.mockImplementation(async ({ where, update }: { where: { walletId: string }; update: Record<string, unknown> }) => ({
    id: "pol_child",
    ...update,
    walletId: where.walletId,
    currentRevision: 4,
  }))
  dbMock.policyRevision.create.mockResolvedValue({})
})

describe("setEnforcementModeAction", () => {
  it("requires a session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "enforce" }))
    expect(result.ok).toBe(false)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
  })

  // A viewer member resolves to the same null as no-session (the WALLET-MEMBERS
  // role floor lives in lib/session.ts's requireSessionRole, not here).
  it("refuses a viewer member the same way as no session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "enforce" }))
    expect(result.ok).toBe(false)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
  })

  it("rejects a mode outside enforce|observe", async () => {
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "audit" }))
    expect(result.ok).toBe(false)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
  })

  it("refuses pools outside the session wallet's subtree", async () => {
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "wallet_foreign", mode: "observe" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/not authorized/i)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
  })

  it("refuses to invent a policy — flipping mode requires one to exist", async () => {
    dbMock.policy.findUnique.mockResolvedValue(null)
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "observe" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no policy/i)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
  })

  it("flips the mode through the revisioned policy path (EVID-1)", async () => {
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "enforce" }))
    expect(result.ok).toBe(true)
    expect(dbMock.policy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId: "pool_child" },
        update: expect.objectContaining({ enforcementMode: "enforce", currentRevision: { increment: 1 } }),
      }),
    )
    // The immutable snapshot lands in the same transaction — the evidence of when enforcement went live.
    expect(dbMock.policyRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: "pool_child", revision: 4 }) }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/observe")
  })

  it("flips back to observe without ceremony", async () => {
    const result = await setEnforcementModeAction(prev, form({ wallet_id: "pool_child", mode: "observe" }))
    expect(result.ok).toBe(true)
    expect(dbMock.policy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ enforcementMode: "observe" }) }),
    )
  })
})
