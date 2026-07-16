import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: tokens/actions.ts's revoke now sits
// behind requireSessionRole("admin") instead of the bare getSessionWallet —
// a viewer resolves to the same null as no session, same denial.
const { dbMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { executionToken: { findUnique: vi.fn(), update: vi.fn() } },
  sessionMock: { requireSessionRole: vi.fn() },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { revokeExecutionTokenAction } from "../app/dashboard/tokens/actions"

const WALLET = { id: "wallet_1" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => vi.clearAllMocks())

describe("revokeExecutionTokenAction — role floor", () => {
  it("denies without touching the db when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    await revokeExecutionTokenAction(form({ id: "tok_1" }))
    expect(dbMock.executionToken.findUnique).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and revokes an active token once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    dbMock.executionToken.findUnique.mockResolvedValue({ id: "tok_1", walletId: "wallet_1", status: "active" })
    await revokeExecutionTokenAction(form({ id: "tok_1" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(dbMock.executionToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok_1" }, data: expect.objectContaining({ status: "revoked" }) }),
    )
  })
})
