import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: spend/actions.ts's policy update (a
// legacy simplified duplicate of policy/actions.ts's editor) now sits behind
// requireSessionRole("admin") instead of the bare getSessionWallet — a
// viewer resolves to the same null as no session, same denial.
const { applyMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  sessionMock: { requireSessionRole: vi.fn() },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/policy", async (orig) => {
  const mod = await orig<typeof import("@/lib/policy")>()
  return { ...mod, applyPolicyUpdate: applyMock }
})
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { updatePolicyAction } from "../app/dashboard/spend/actions"

const WALLET = { id: "wallet_1" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  applyMock.mockResolvedValue({ ok: true, policy: {} })
})

describe("updatePolicyAction (spend) — role floor", () => {
  it("denies without writing when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await updatePolicyAction({ ok: false, message: "" }, form({ daily_token_budget_usd: "10" }))
    expect(res.ok).toBe(false)
    expect(applyMock).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and writes once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    const res = await updatePolicyAction({ ok: false, message: "" }, form({ daily_token_budget_usd: "10" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(res.ok).toBe(true)
    expect(applyMock).toHaveBeenCalledWith("wallet_1", expect.any(Object))
  })
})
